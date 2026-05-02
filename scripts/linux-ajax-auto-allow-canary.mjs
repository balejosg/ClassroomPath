#!/usr/bin/env node

import dns from 'node:dns/promises';
import { appendFileSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  LINUX_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  LINUX_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  withLinuxAutoAllowDiagnostics,
} from './lib/linux-auto-allow-canary-evidence.mjs';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
} from './lib/windows-auto-allow-canary-evidence.mjs';
import {
  buildAjaxAutoAllowCanaryPage,
  buildAjaxAutoAllowProbeUrl,
  buildCompletedProbesFromHits,
  createAjaxAutoAllowCanaryServer,
  createAjaxAutoAllowCanaryState,
  hasAllAjaxAutoAllowProbesCompleted,
  waitForAjaxAutoAllowPageObserver,
} from './lib/ajax-auto-allow-canary-harness.mjs';
import { collectCanaryGroupDiagnostics as collectCanaryGroupDiagnosticsFromApi } from './lib/canary-group-diagnostics.mjs';
import { evaluateLinuxAjaxBrowserPageOutcome } from './linux-ajax-canary-result.mjs';

const PORT = Number.parseInt(process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18089', 10);
const TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000',
  10
);
const PAGE_LOAD_TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_PAGE_LOAD_TIMEOUT_MS ?? '15000',
  10
);
const PAGE_OBSERVER_WAIT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_PAGE_OBSERVER_WAIT_MS ?? '30000',
  10
);
const FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_FIREFOX_WARMUP_TIMEOUT_MS ?? '15000',
  10
);
const PROBE_TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_PROBE_TIMEOUT_MS ?? '5000',
  10
);
const ENROLLMENT_WAIT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_ENROLLMENT_WAIT_MS ?? '30000',
  10
);
const ARTIFACT_PATH =
  process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT ??
  'production-linux-ajax-auto-allow-canary.json';
const CANARY_API_URL = (process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL ?? '').replace(/\/$/, '');
const CANARY_GROUP_ID = process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID ?? '';
const CANARY_ADMIN_TOKEN = process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN ?? '';
const WHITELIST_PATH = process.env.OPENPATH_WHITELIST_PATH ?? '/var/lib/openpath/whitelist.txt';
const EXPECTED_EXTENSION_ID = process.env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath';
const FIREFOX_EXTENSION_PATH_CANDIDATES = [
  process.env.LINUX_AJAX_AUTO_ALLOW_FIREFOX_EXTENSION_PATH ?? '',
  '/usr/share/openpath/firefox-release/openpath-firefox-extension.xpi',
  '/usr/share/openpath/firefox-extension/openpath-firefox-extension.xpi',
].filter(Boolean);
const execFileAsync = promisify(execFile);

class LinuxAjaxAutoAllowFunctionalFailure extends Error {}

function writeGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProbeUrl(probe) {
  return buildAjaxAutoAllowProbeUrl(probe, PORT);
}

function extractFirefoxExtensionUuid(prefsContent, extensionId) {
  const match = /user_pref\("extensions\.webextensions\.uuids",\s*"(.+)"\);/.exec(prefsContent);
  if (!match?.[1]) {
    return null;
  }

  try {
    const rawJson = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const mapping = JSON.parse(rawJson);
    const extensionUuid = mapping?.[extensionId];
    return typeof extensionUuid === 'string' && extensionUuid !== '' ? extensionUuid : null;
  } catch {
    return null;
  }
}

async function waitForFirefoxExtensionUuid({
  profileDir,
  extensionId,
  timeoutMs = FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
  pollMs = 100,
}) {
  const prefsPath = join(profileDir, 'prefs.js');
  const deadline = Date.now() + timeoutMs;
  let lastPrefsContent = '';

  while (Date.now() < deadline) {
    try {
      lastPrefsContent = await readFile(prefsPath, 'utf8');
      const extensionUuid = extractFirefoxExtensionUuid(lastPrefsContent, extensionId);
      if (extensionUuid) {
        return extensionUuid;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await sleep(pollMs);
  }

  const profileSummary = lastPrefsContent.includes('extensions.webextensions.uuids')
    ? 'extensions.webextensions.uuids present without expected extension'
    : 'extensions.webextensions.uuids missing';
  throw new Error(
    `Could not resolve Firefox extension UUID for ${extensionId} in ${prefsPath}: ${profileSummary}`
  );
}

async function waitForFirefoxExtensionRuntimeReady({
  driver,
  profileDir,
  extensionId = EXPECTED_EXTENSION_ID,
  timeoutMs = FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
}) {
  const extensionUuid = await waitForFirefoxExtensionUuid({ profileDir, extensionId, timeoutMs });
  const popupUrl = `moz-extension://${extensionUuid}/popup/popup.html`;
  let popupLoadError = null;

  try {
    await driver.get(popupUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Navigation timed out')) {
      throw error;
    }
    popupLoadError = message;
  }

  await driver.wait(async () => {
    try {
      return await driver.executeScript(
        `return typeof globalThis.browser?.runtime?.sendMessage === 'function';`
      );
    } catch {
      return false;
    }
  }, timeoutMs);

  return {
    ready: true,
    expectedExtensionId: extensionId,
    extensionUuid,
    profileDir,
    popupUrl,
    popupLoadError,
  };
}

async function resolveFirefoxCanaryExtensionPath() {
  for (const candidate of FIREFOX_EXTENSION_PATH_CANDIDATES) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

async function readFileEvidence(path, expectedHosts = []) {
  try {
    const [fileStat, contents] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    const lowerContents = contents.toLowerCase();
    return {
      path,
      present: true,
      size: fileStat.size,
      whitelistMtimeMs: fileStat.mtimeMs,
      containsExpectedHosts: Object.fromEntries(
        expectedHosts.map((host) => [host, lowerContents.includes(host.toLowerCase())])
      ),
    };
  } catch (error) {
    return {
      path,
      present: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readTextEvidence(path, options = {}) {
  const maxChars = options.maxChars ?? 12000;
  try {
    const [fileStat, contents] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    return {
      path,
      present: true,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      contents: contents.slice(-maxChars),
      truncated: contents.length > maxChars,
    };
  } catch (error) {
    return {
      path,
      present: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectCanaryGroupDiagnostics() {
  return collectCanaryGroupDiagnosticsFromApi({
    apiUrl: CANARY_API_URL,
    groupId: CANARY_GROUP_ID,
    adminToken: CANARY_ADMIN_TOKEN,
    sleep,
  });
}

async function runDiagnosticCommand(command, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      command: [command, ...args].join(' '),
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(' '),
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr : '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectOriginPreflight(originUrl) {
  const [http, lookup] = await Promise.all([
    fetch(originUrl, {
      headers: { Host: `${ORIGIN_HOST}:${PORT}` },
      signal: AbortSignal.timeout(5000),
    })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        bodyPrefix: (await response.text()).slice(0, 120),
      }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })),
    dns
      .lookup(ORIGIN_HOST, { all: true })
      .then((addresses) => ({ ok: true, addresses }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  return {
    originHost: ORIGIN_HOST,
    originUrl,
    http,
    dns: { originHost: lookup },
  };
}

async function collectBrowserNavigationDiagnostics(driver) {
  try {
    return {
      ok: true,
      ...(await driver.executeScript(`return {
        href: window.location.href,
        readyState: document.readyState,
        title: document.title,
        bodyTextPrefix: (document.body?.innerText || '').slice(0, 200),
        openpathObserverInstalled: window.__openpathPageResourceObserverInstalled === true,
        openpathObserverState: window.__openpathPageResourceObserverState ?? null,
        canaryState: window.__openpathLinuxAjaxCanaryState ?? null,
      };`)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectLinuxFailureDebugSnapshot() {
  const systemctlCommand =
    'systemctl status openpath-sse-listener.service openpath-update.service --no-pager';
  const journalctlCommand =
    'journalctl -u openpath-sse-listener.service -u openpath-update.service --no-pager -n 120';
  const resolvConfCommand = 'cat /etc/resolv.conf';
  const originGetentCommand = `getent hosts ${ORIGIN_HOST}`;
  const [
    systemctl,
    journalctl,
    resolvConf,
    originGetent,
    whitelist,
    apiUrlConfig,
    firefoxNativeHostManifest,
    rootFirefoxNativeHostManifest,
    userNativeHostLog,
    tmpNativeHostLog,
  ] = await Promise.all([
    runDiagnosticCommand('systemctl', [
      'status',
      'openpath-sse-listener.service',
      'openpath-update.service',
      '--no-pager',
    ]),
    runDiagnosticCommand('journalctl', [
      '-u',
      'openpath-sse-listener.service',
      '-u',
      'openpath-update.service',
      '--no-pager',
      '-n',
      '120',
    ]),
    runDiagnosticCommand('cat', ['/etc/resolv.conf']),
    runDiagnosticCommand('getent', ['hosts', `${ORIGIN_HOST}`]),
    readFileEvidence(WHITELIST_PATH, [ORIGIN_HOST]),
    readTextEvidence('/etc/openpath/api-url.conf'),
    readTextEvidence('/usr/lib/mozilla/native-messaging-hosts/whitelist_native_host.json'),
    readTextEvidence('/root/.mozilla/native-messaging-hosts/whitelist_native_host.json'),
    readTextEvidence(join(process.env.HOME ?? '', '.local/share/openpath/native-host.log')),
    readTextEvidence('/tmp/openpath-native-host.log'),
  ]);

  return {
    systemctl: { ...systemctl, systemctlCommand },
    journalctl: { ...journalctl, journalctlCommand },
    resolvConf: { ...resolvConf, resolvConfCommand },
    getent: { originHost: originGetent, originGetentCommand },
    whitelist,
    requestApiConfig: {
      apiUrlConfig,
    },
    nativeHost: {
      firefoxNativeHostManifest,
      rootFirefoxNativeHostManifest,
      logs: {
        userNativeHostLog,
        tmpNativeHostLog,
      },
    },
  };
}

async function waitForEnrollmentSeed(timeoutMs = ENROLLMENT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const evidence = await readFileEvidence(WHITELIST_PATH, [ORIGIN_HOST]);
    if (evidence.containsExpectedHosts?.[ORIGIN_HOST] === true) {
      return { observed: true, timeoutMs, evidence };
    }
    await sleep(1000);
  }

  const debug = await collectLinuxFailureDebugSnapshot();
  console.error(`LINUX_AJAX_ENROLLMENT_SEED_MISSING ${JSON.stringify(debug)}`);
  return {
    observed: false,
    timeoutMs,
    evidence: await readFileEvidence(WHITELIST_PATH, [ORIGIN_HOST]),
    debug,
  };
}

async function collectLinuxAutoAllowDiagnostics(label, expectedHosts = []) {
  const localWhitelist = await readFileEvidence(WHITELIST_PATH, expectedHosts);
  const dnsContains = {};
  const dnsLookups = {};

  for (const host of expectedHosts) {
    try {
      const addresses = await dns.lookup(host, { all: true });
      dnsContains[host] = addresses.length > 0;
      dnsLookups[host] = { ok: true, addresses };
    } catch (error) {
      dnsContains[host] = false;
      dnsLookups[host] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    label,
    whitelist: {
      local: localWhitelist,
    },
    dns: {
      originHost: dnsLookups[ORIGIN_HOST] ?? null,
      containsExpectedHosts: dnsContains,
      lookups: dnsLookups,
    },
    server: {
      canaryGroup: await collectCanaryGroupDiagnostics(),
    },
  };
}

async function collectRedditDiagnostics(phase, pageEvidence = {}) {
  const [localWhitelist, canaryGroup] = await Promise.all([
    readFileEvidence(WHITELIST_PATH, REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
    collectCanaryGroupDiagnostics(),
  ]);

  return {
    phase,
    collectedAt: new Date().toISOString(),
    hosts: REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
    probes: REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
    page: pageEvidence,
    whitelist: {
      local: localWhitelist,
    },
    server: {
      canaryGroup,
    },
  };
}

function createCanaryServer({ state }) {
  return createAjaxAutoAllowCanaryServer({
    platform: 'Linux',
    probes: AUTO_ALLOW_PROBES,
    originHost: ORIGIN_HOST,
    port: PORT,
    state,
    scriptGlobalName: '__openpathLinuxAjaxAutoAllowScriptProbe',
    stylesheetCss: 'body { --openpath-linux-ajax-auto-allow-style-probe: loaded; }',
    buildPage: () =>
      buildAjaxAutoAllowCanaryPage({
        platform: 'Linux',
        probes: AUTO_ALLOW_PROBES,
        originHost: ORIGIN_HOST,
        port: PORT,
        timeoutMs: TIMEOUT_MS,
        probeTimeoutMs: PROBE_TIMEOUT_MS,
        stateGlobalName: '__openpathLinuxAjaxCanaryState',
      }),
  });
}

async function launchFirefox(originUrl) {
  const { Builder } = await import('selenium-webdriver');
  const firefox = await import('selenium-webdriver/firefox.js');
  const seleniumExtensionPath = await resolveFirefoxCanaryExtensionPath();
  const options = new firefox.Options();
  options.addArguments('-headless');
  if (seleniumExtensionPath !== null) {
    options.addExtensions(seleniumExtensionPath);
  }
  options.setPreference('network.dns.disablePrefetch', true);
  options.setPreference('network.trr.mode', 5);
  options.setPreference('network.trr.uri', '');
  options.setPreference('network.dnsCacheExpiration', 0);
  options.setPreference('network.dnsCacheExpirationGracePeriod', 0);
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ pageLoad: PAGE_LOAD_TIMEOUT_MS, script: 10000 });
  const capabilities = await driver.getCapabilities();
  const profileDir = capabilities.get('moz:profile');
  if (typeof profileDir !== 'string' || profileDir === '') {
    throw new Error('Firefox did not expose a moz:profile path for extension warmup');
  }
  const firefoxExtensionWarmup = await waitForFirefoxExtensionRuntimeReady({
    driver,
    profileDir,
  }).catch((error) => ({
    ready: false,
    expectedExtensionId: EXPECTED_EXTENSION_ID,
    profileDir,
    seleniumExtensionPath,
    error: error instanceof Error ? error.message : String(error),
  }));
  firefoxExtensionWarmup.seleniumExtensionPath = seleniumExtensionPath;
  if (!firefoxExtensionWarmup.ready) {
    console.error(
      `Linux AJAX canary Firefox extension warmup failed: ${firefoxExtensionWarmup.error}`
    );
  }
  let firstPageLoadCompleted = true;
  let firstPageLoadError = null;
  try {
    await driver.get(originUrl);
  } catch (error) {
    firstPageLoadCompleted = false;
    firstPageLoadError = error instanceof Error ? error.message : String(error);
    console.error(
      `Linux AJAX canary page load did not complete within ${PAGE_LOAD_TIMEOUT_MS}ms: ${
        firstPageLoadError
      }`
    );
  }
  return { driver, firstPageLoadCompleted, firstPageLoadError, profileDir, firefoxExtensionWarmup };
}

async function waitForPageObserver(driver, originUrl) {
  return waitForAjaxAutoAllowPageObserver({
    driver,
    originUrl,
    timeoutMs: PAGE_OBSERVER_WAIT_MS,
    collectBrowserNavigationDiagnostics,
    onReloadError: (error) => {
      console.error(
        `Linux AJAX canary observer reload did not complete: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    },
  });
}

async function main() {
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  const expectedHosts = [
    ORIGIN_HOST,
    ...AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost),
  ];
  const state = createAjaxAutoAllowCanaryState(AUTO_ALLOW_PROBES);
  const server = createCanaryServer({ state });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });

  let firefoxSession = null;
  const enrollmentSeed = await waitForEnrollmentSeed();
  const originPreflight = await collectOriginPreflight(originUrl);
  const preflight = {
    ...(await collectLinuxAutoAllowDiagnostics('preflight', expectedHosts)),
    enrollmentSeed,
    originPreflight,
  };
  try {
    firefoxSession = await launchFirefox(originUrl);
    const browserNavigationBeforeAttempts = await waitForPageObserver(
      firefoxSession.driver,
      originUrl
    );
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        hasAllAjaxAutoAllowProbesCompleted(AUTO_ALLOW_PROBES, state.completedProbes) &&
        state.pageObserverInstalled
      ) {
        break;
      }
      await sleep(1000);
    }

    const browserNavigationAfterAttempts = await collectBrowserNavigationDiagnostics(
      firefoxSession.driver
    );
    const postAttempt = await collectLinuxAutoAllowDiagnostics('post-attempt', expectedHosts);
    const completedProbesFromTraffic = buildCompletedProbesFromHits(
      AUTO_ALLOW_PROBES,
      state.probeHits
    );
    const browserCompletedCandidateEvents =
      browserNavigationAfterAttempts.canaryState?.completedCandidateEvents ??
      browserNavigationBeforeAttempts.canaryState?.completedCandidateEvents ??
      {};
    const browserPageResourceCandidateEvents =
      browserNavigationAfterAttempts.canaryState?.pageResourceCandidateEvents ??
      browserNavigationBeforeAttempts.canaryState?.pageResourceCandidateEvents ??
      [];
    const completedCandidateEvents = {
      ...browserCompletedCandidateEvents,
      ...state.completedCandidateEvents,
    };
    const pageResourceCandidateEvents =
      state.pageResourceCandidateEvents.length > 0
        ? state.pageResourceCandidateEvents
        : browserPageResourceCandidateEvents;
    const completedRedditDiagnosticEvents =
      browserNavigationAfterAttempts.canaryState?.completedRedditDiagnosticEvents ??
      browserNavigationBeforeAttempts.canaryState?.completedRedditDiagnosticEvents ??
      {};
    const probeEvidence = AUTO_ALLOW_PROBES.map((probe) => ({
      id: probe.id,
      kind: probe.kind,
      host: probe.host,
      url: buildProbeUrl(probe),
      hits: state.probeHits[probe.id] ?? 0,
      expectedWhitelistHost: probe.expectedWhitelistHost,
      whitelistContainsExpectedHost:
        postAttempt.whitelist.local.containsExpectedHosts?.[probe.expectedWhitelistHost] === true,
    }));
    const pageObserverInstalled =
      state.pageObserverInstalled ||
      browserNavigationAfterAttempts.openpathObserverInstalled === true ||
      browserNavigationBeforeAttempts.openpathObserverInstalled === true;
    const browserPageOutcome = evaluateLinuxAjaxBrowserPageOutcome({
      firstPageLoadCompleted: firefoxSession.firstPageLoadCompleted,
      firstPageLoadError: firefoxSession.firstPageLoadError,
      browserNavigation: {
        beforeAttempts: browserNavigationBeforeAttempts,
        afterAttempts: browserNavigationAfterAttempts,
      },
      expectedProbeIds: AUTO_ALLOW_PROBES.map((probe) => probe.id),
    });
    const success =
      hasAllAjaxAutoAllowProbesCompleted(AUTO_ALLOW_PROBES, completedProbesFromTraffic) &&
      pageObserverInstalled &&
      browserPageOutcome.success;
    const failureDebug = success ? null : await collectLinuxFailureDebugSnapshot();
    const redditDiagnostics = await collectRedditDiagnostics(
      success ? 'post-success' : 'post-failure',
      {
        completedRedditDiagnosticEvents,
        pageResourceCandidateEvents,
      }
    );
    const summary = withLinuxAutoAllowDiagnostics({
      success,
      error: success ? null : 'Linux AJAX auto-allow probes did not complete before timeout',
      originHost: ORIGIN_HOST,
      originUrl,
      expectedExtensionId: EXPECTED_EXTENSION_ID,
      originHits: state.originPageHits,
      originPageHits: state.originPageHits,
      firstPageLoadCompleted: firefoxSession.firstPageLoadCompleted,
      firstPageLoadError: firefoxSession.firstPageLoadError,
      attemptHits: state.attemptHits,
      completedProbes: completedProbesFromTraffic,
      completedCandidateEvents,
      pageResourceCandidateEvents,
      pageObserverInstalled,
      pageObserverState:
        state.pageObserverState ||
        browserNavigationAfterAttempts.openpathObserverState ||
        browserNavigationBeforeAttempts.openpathObserverState ||
        null,
      probeEvidence,
      firefoxExtensionWarmup: firefoxSession.firefoxExtensionWarmup,
      browserNavigation: {
        beforeAttempts: browserNavigationBeforeAttempts,
        afterAttempts: browserNavigationAfterAttempts,
      },
      browserPageOutcome,
      redditDiagnostics,
      diagnostics: { preflight, postAttempt },
      failureDebug,
      artifactWritten: true,
    });

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.error(`LINUX_AJAX_AUTO_ALLOW_CANARY_SUMMARY ${JSON.stringify(summary)}`);
    writeGithubOutput('linux_ajax_auto_allow_result', success ? 'success' : 'failure');
    writeGithubOutput('failure_boundary_id', summary.failureBoundary?.id ?? 'unknown');
    writeGithubOutput('failure_boundary_message', summary.failureBoundary?.message ?? '');
    if (!success) throw new LinuxAjaxAutoAllowFunctionalFailure(summary.error);
  } finally {
    await firefoxSession?.driver?.quit().catch(() => {});
    await rm(firefoxSession?.profileDir ?? '', { recursive: true, force: true }).catch(() => {});
    server.close();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof LinuxAjaxAutoAllowFunctionalFailure)) {
    await writeFile(
      ARTIFACT_PATH,
      `${JSON.stringify({ success: false, error: message, artifactWritten: true }, null, 2)}\n`,
      'utf8'
    ).catch(() => {});
  }
  console.error(message);
  process.exit(1);
});
