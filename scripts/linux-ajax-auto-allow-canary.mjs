#!/usr/bin/env node

/**
 * Runs the Linux AJAX auto-allow canary: launches Firefox under Selenium, visits probe URLs, and writes per-probe evidence JSON.
 *
 * Invoked by: GitHub Actions `linux-production-bootstrap-canary.yml` workflow; also `runner-diagnostic-execution`.
 * Usage: node scripts/linux-ajax-auto-allow-canary.mjs
 * Env: LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID, LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN, LINUX_AJAX_AUTO_ALLOW_FIREFOX_EXTENSION_URL.
 */

import dns from 'node:dns/promises';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  LINUX_AUTO_ALLOW_ALL_PROBES,
  LINUX_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  LINUX_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  withLinuxAutoAllowDiagnostics,
} from './lib/linux-auto-allow-canary-evidence.mjs';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
} from './lib/windows-auto-allow-canary-evidence.mjs';
import {
  buildAjaxAutoAllowProbeUrl,
  buildCompletedProbesFromHits,
  hasAllAjaxAutoAllowProbesCompleted,
  openUrlWithTransientBrowserRetry,
  waitForAjaxAutoAllowPageObserver,
} from './lib/ajax-auto-allow-canary-harness.mjs';
import {
  createAjaxAutoAllowCanaryRuntimeProgress,
  createAjaxAutoAllowCanaryRuntimeServer,
  emitAjaxAutoAllowCanaryRuntimeSummary,
  listenAjaxAutoAllowCanaryRuntimeServer,
} from './lib/ajax-auto-allow-canary-runtime.mjs';
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
// Management-host (staging API) name, used by the failure snapshot to check whether the
// agent's dnsmasq resolves it and whether its IP is in the firewall allow set. The
// explicit-whitelist-apply boundary needs a NEW connection to this host; when it
// connect-times-out we want to see the live ipset/iptables/dnsmasq state on the runner.
const CANARY_API_HOST = (() => {
  try {
    return CANARY_API_URL ? new URL(CANARY_API_URL).hostname : '';
  } catch {
    return '';
  }
})();
const CANARY_GROUP_ID = process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID ?? '';
const CANARY_ADMIN_TOKEN = process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN ?? '';
const WHITELIST_PATH = process.env.OPENPATH_WHITELIST_PATH ?? '/var/lib/openpath/whitelist.txt';
const EXPECTED_EXTENSION_ID = process.env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath';
const LINUX_AJAX_AUTO_ALLOW_FAILURE_MESSAGE =
  'Linux explicit AJAX/page-resource probes did not complete before timeout';
const FIREFOX_EXTENSION_URL_CANDIDATES = [
  process.env.LINUX_AJAX_AUTO_ALLOW_FIREFOX_EXTENSION_URL ?? '',
  CANARY_API_URL ? `${CANARY_API_URL}/api/extensions/firefox/openpath.xpi` : '',
].filter(Boolean);
const FIREFOX_EXTENSION_PATH_CANDIDATES = [
  process.env.LINUX_AJAX_AUTO_ALLOW_FIREFOX_EXTENSION_PATH ?? '',
  '/usr/share/openpath/firefox-release/openpath-firefox-extension.xpi',
  '/usr/share/openpath/firefox-extension/openpath-firefox-extension.xpi',
  '/usr/share/openpath/firefox-extension',
].filter(Boolean);
const execFileAsync = promisify(execFile);

class LinuxAjaxAutoAllowFunctionalFailure extends Error {}

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
  // Prefer downloading the served XPI (the artifact under test), but a download must NOT be able
  // to wedge the whole canary: the fetch's AbortSignal.timeout does not reliably interrupt a stalled
  // body read, so a transient network blip on the runner used to hang until the 90s top-level abort
  // (firefox-extension-ready failure with no evidence). On any download failure, fall through to the
  // locally-installed agent XPI candidates instead of throwing.
  for (const extensionUrl of FIREFOX_EXTENSION_URL_CANDIDATES) {
    try {
      return await materializeFirefoxCanaryExtensionDownload(extensionUrl);
    } catch (error) {
      console.error(
        `CANARY_DIAG firefox-warmup: download from ${extensionUrl} failed (${error instanceof Error ? error.message : String(error)}); falling back to local extension`
      );
    }
  }

  for (const candidate of FIREFOX_EXTENSION_PATH_CANDIDATES) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
      if (candidateStat.isDirectory()) {
        return await materializeFirefoxCanaryExtensionArchive(candidate);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

async function materializeFirefoxCanaryExtensionDownload(extensionUrl) {
  const archiveDir = await mkdtemp(join(tmpdir(), 'openpath-firefox-canary-extension-'));
  const archivePath = join(archiveDir, 'openpath-firefox-extension.xpi');
  // Hard wall-clock cap around the whole fetch+body read: AbortSignal.timeout aborts the request
  // phase but does not reliably interrupt a stalled `arrayBuffer()`, which is what hung the canary.
  const DOWNLOAD_TIMEOUT_MS = 20000;
  let timer;
  const response = await Promise.race([
    fetch(extensionUrl, { signal: AbortSignal.timeout(10000) }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out downloading Firefox extension from ${extensionUrl}`)),
        DOWNLOAD_TIMEOUT_MS
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (!response.ok) {
    throw new Error(
      `Could not download signed Firefox extension from ${extensionUrl}: HTTP ${response.status}`
    );
  }

  let bodyTimer;
  const extensionBytes = Buffer.from(
    await Promise.race([
      response.arrayBuffer(),
      new Promise((_, reject) => {
        bodyTimer = setTimeout(
          () => reject(new Error(`Timed out reading Firefox extension body from ${extensionUrl}`)),
          DOWNLOAD_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(bodyTimer))
  );
  if (extensionBytes.byteLength === 0) {
    throw new Error(`Downloaded signed Firefox extension is empty: ${extensionUrl}`);
  }

  await writeFile(archivePath, extensionBytes);
  return archivePath;
}

async function materializeFirefoxCanaryExtensionArchive(extensionDir) {
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifestStat = await stat(manifestPath);
  if (!manifestStat.isFile()) {
    throw new Error(`Firefox extension directory is missing manifest.json: ${extensionDir}`);
  }

  const archiveDir = await mkdtemp(join(tmpdir(), 'openpath-firefox-canary-extension-'));
  const archivePath = join(archiveDir, 'openpath-firefox-extension.xpi');
  await execFileAsync('zip', ['-qr', archivePath, '.'], {
    cwd: extensionDir,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return archivePath;
}

function readFirefoxExtensionIdFromManifest(manifestText) {
  const manifest = JSON.parse(manifestText);
  const extensionId =
    manifest?.browser_specific_settings?.gecko?.id ?? manifest?.applications?.gecko?.id;
  return typeof extensionId === 'string' && extensionId !== '' ? extensionId : null;
}

async function resolveFirefoxExpectedExtensionId(extensionPath) {
  if (!extensionPath) {
    return EXPECTED_EXTENSION_ID;
  }

  const extensionStat = await stat(extensionPath);
  if (extensionStat.isDirectory()) {
    const manifestText = await readFile(join(extensionPath, 'manifest.json'), 'utf8');
    return readFirefoxExtensionIdFromManifest(manifestText) ?? EXPECTED_EXTENSION_ID;
  }

  const { stdout } = await execFileAsync('unzip', ['-p', extensionPath, 'manifest.json'], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return readFirefoxExtensionIdFromManifest(stdout) ?? EXPECTED_EXTENSION_ID;
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

let loggedObserverRealmDiag = false;
async function collectBrowserNavigationDiagnostics(driver) {
  try {
    const payload = await driver.executeScript(`return {
        href: window.location.href,
        readyState: document.readyState,
        title: document.title,
        bodyTextPrefix: (document.body?.innerText || '').slice(0, 200),
        openpathObserverInstalled: window.__openpathPageResourceObserverInstalled === true,
        openpathObserverState: window.__openpathPageResourceObserverState ?? null,
        canaryState: window.__openpathLinuxAjaxCanaryState ?? null,
        diagHasWrappedJSObject: typeof window.wrappedJSObject,
        diagObserverInstalledWrapped:
          typeof window.wrappedJSObject !== 'undefined' &&
          window.wrappedJSObject.__openpathPageResourceObserverInstalled === true,
      };`);
    // Diagnostic (additive, does not affect pass/fail): emitted once after the
    // page leaves 'loading'. Distinguishes "world:MAIN observer never executed"
    // (plain=false AND wrapped=false) from "observer ran but executeScript's
    // realm/Xray hides the MAIN-world expando" (plain=false BUT wrapped=true).
    if (!loggedObserverRealmDiag && payload.readyState && payload.readyState !== 'loading') {
      loggedObserverRealmDiag = true;
      let browserVersion = null;
      let geckodriverVersion = null;
      try {
        const caps = await driver.getCapabilities();
        browserVersion = caps.get('browserVersion') ?? null;
        geckodriverVersion = caps.get('moz:geckodriverVersion') ?? null;
      } catch {
        // capabilities are best-effort for diagnostics only
      }
      console.error(
        `CANARY_DIAG observer-realm: plain=${payload.openpathObserverInstalled} ` +
          `wrapped=${payload.diagObserverInstalledWrapped} ` +
          `hasWrappedJSObject=${payload.diagHasWrappedJSObject} ` +
          `readyState=${payload.readyState} browser=${browserVersion} gecko=${geckodriverVersion}`
      );
    }
    return {
      ok: true,
      ...payload,
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
    allowIpset,
    allowIpset6,
    outputChain,
    apiHostResolution,
    dnsmasqConfig,
    apiHostDnsmasqA,
    apiHostDnsmasqAaaa,
    openpathLog,
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
    // Live firewall allow-set: does the management host's resolved IP land in the
    // openpath-allow-dst ipset that the OUTPUT whitelist-ACCEPT is scoped to?
    runDiagnosticCommand('sudo', ['ipset', 'list', 'openpath-allow-dst']),
    runDiagnosticCommand('sudo', ['ipset', 'list', 'openpath-allow-dst6']),
    // Live OUTPUT chain: confirm the whitelist-ACCEPT precedes the deny and see
    // exactly what would drop a new connection to the management host.
    runDiagnosticCommand('sudo', ['iptables', '-S', 'OUTPUT']),
    // Does the agent's dnsmasq resolve the management host (and thus populate the
    // allow-set) at failure time?
    CANARY_API_HOST
      ? runDiagnosticCommand('getent', ['hosts', CANARY_API_HOST])
      : Promise.resolve(null),
    // Live generated dnsmasq config: is the management host emitted as a
    // protected-domain server= forward, or is it falling through to the wildcard
    // sinkhole (address=/#/...) at failure time? Generator is proven to emit it;
    // this reveals whether the *active* config diverges at runtime.
    runDiagnosticCommand('sudo', [
      'bash',
      '-c',
      "grep -nE 'address=/#/|server=/|classroompath' /etc/dnsmasq.d/openpath.conf 2>&1 | head -40",
    ]),
    // What the agent's own resolver (dnsmasq on 127.0.0.1) answers for the
    // management host, split by family -- distinguishes "no A" from "AAAA sink".
    CANARY_API_HOST
      ? runDiagnosticCommand('getent', ['ahostsv4', CANARY_API_HOST])
      : Promise.resolve(null),
    CANARY_API_HOST
      ? runDiagnosticCommand('getent', ['ahostsv6', CANARY_API_HOST])
      : Promise.resolve(null),
    // openpath-update dnsmasq generation log (protected-domain emission, upstream
    // selection, restart) -- not in journald.
    runDiagnosticCommand('sudo', ['bash', '-c', 'tail -n 80 /var/log/openpath.log 2>&1']),
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
    // Management-host (staging API) reachability path. The explicit-whitelist-apply
    // boundary opens a NEW connection to this host; when it connect-times-out while
    // the established SSE stays up, these reveal whether the host resolved and whether
    // its IP made it into the firewall allow-set.
    managementHostPath: {
      apiHost: CANARY_API_HOST,
      apiHostResolution,
      apiHostDnsmasqA,
      apiHostDnsmasqAaaa,
      dnsmasqConfig,
      openpathLog,
      allowIpset,
      allowIpset6,
      outputChain,
    },
  };
}

// OpenPath sinkholes blocked/not-yet-applied domains to these sentinels
// (mirrors firefox-extension/native/openpath-native-host.py BLOCKED_DNS_SENTINELS).
const BLOCKED_DNS_SENTINELS = new Set(['0.0.0.0', '::', '192.0.2.1', '100::']);

function isBlockedDnsSentinel(address) {
  return BLOCKED_DNS_SENTINELS.has(
    String(address ?? '')
      .trim()
      .toLowerCase()
  );
}

// The whitelist file is written (download_whitelist) before openpath-update.sh
// finishes generate_dnsmasq_config + restart_dnsmasq, so the origin appearing in
// whitelist.txt does NOT mean the active resolver serves its real IP yet. Block
// until the origin resolves to a non-sinkhole address before navigating.
async function waitForOriginDnsReady(timeoutMs = ENROLLMENT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastResult = null;
  while (Date.now() <= deadline) {
    try {
      const addresses = await dns.lookup(ORIGIN_HOST, { all: true });
      const realAddresses = addresses.filter((entry) => !isBlockedDnsSentinel(entry.address));
      lastResult = { ok: true, addresses };
      if (realAddresses.length > 0) {
        return { resolved: true, timeoutMs, addresses, realAddresses };
      }
    } catch (error) {
      lastResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(1000);
  }
  return { resolved: false, timeoutMs, lastResult };
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

export function createLinuxAjaxAutoAllowCanaryHarness({
  port = PORT,
  timeoutMs = TIMEOUT_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  onResult,
} = {}) {
  return createAjaxAutoAllowCanaryRuntimeServer({
    platformAdapter: {
      label: 'Linux',
      probes: LINUX_AUTO_ALLOW_ALL_PROBES,
      originHost: ORIGIN_HOST,
      stateGlobalName: '__openpathLinuxAjaxCanaryState',
      scriptGlobalName: '__openpathLinuxAjaxAutoAllowScriptProbe',
      stylesheetCss: 'body { --openpath-linux-ajax-auto-allow-style-probe: loaded; }',
    },
    port,
    timeoutMs,
    probeTimeoutMs,
    onResult,
  });
}

function createCanaryServer() {
  return createLinuxAjaxAutoAllowCanaryHarness({
    port: PORT,
    timeoutMs: TIMEOUT_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
  });
}

async function createFirefoxSession() {
  // Flush-immediately diagnostics: createFirefoxSession is the only stretch with an UNBOUNDED
  // operation (the Selenium Builder().build() Firefox launch). When that hangs, the canary's
  // 90s top-level timeout aborts the whole process before any structured evidence is written,
  // so the failure is a black box (firefoxExtensionWarmup=null). These stderr breadcrumbs survive
  // the abort, so the last line printed pinpoints exactly where the warmup stalled.
  const diag = (msg) => console.error(`CANARY_DIAG firefox-warmup: ${msg}`);
  diag('importing selenium-webdriver');
  const { Builder } = await import('selenium-webdriver');
  const firefox = await import('selenium-webdriver/firefox.js');
  diag('resolving selenium extension path');
  const seleniumExtensionPath = await resolveFirefoxCanaryExtensionPath();
  diag(`selenium extension path = ${seleniumExtensionPath ?? '(none)'}`);
  const expectedExtensionId = await resolveFirefoxExpectedExtensionId(seleniumExtensionPath);
  diag(`expected extension id = ${expectedExtensionId}`);
  const options = new firefox.Options();
  // The canary must exercise the production browser the OpenPath agent installs
  // (firefox-esr from the Mozilla apt repo), NOT the runner's default Firefox.
  // Ubuntu ships Firefox as a confined snap whose sandbox prevents world:MAIN
  // content scripts (the page-resource observer) from executing, so a
  // geckodriver-auto-selected snap Firefox fails the page-observer boundary even
  // though the extension and agent are correct. Diagnostic evidence: the canary
  // ran on snap firefox 152.0.1 with the observer absent (plain=false,
  // wrapped=false, page realm), while firefox-esr 140.12 installs it reliably.
  let openpathFirefoxBinary = null;
  for (const candidate of [
    '/usr/bin/firefox-esr',
    '/usr/lib/firefox-esr/firefox-esr',
    '/opt/firefox/firefox',
  ]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        openpathFirefoxBinary = candidate;
        break;
      }
    } catch {
      // candidate not present; try the next
    }
  }
  if (openpathFirefoxBinary !== null) {
    options.setBinary(openpathFirefoxBinary);
    diag(`using OpenPath-managed firefox binary: ${openpathFirefoxBinary}`);
  } else {
    diag('OpenPath firefox-esr binary not found; using geckodriver default Firefox');
  }
  // This page deliberately loads blocked (sinkholed) ajax-observe-* sub-resources
  // that hang on the 100:: discard sink, so pageLoadStrategy 'normal' would block
  // window.load until the pageLoad timeout fires. Mirror linux-firefox-block-page-canary
  // and use 'none': driver.get returns once navigation starts, and waitForPageObserver
  // then waits for the document_start observer + probe results.
  options.setPageLoadStrategy('none');
  options.addArguments('-headless');
  if (seleniumExtensionPath !== null) {
    options.addExtensions(seleniumExtensionPath);
  }
  options.setPreference('network.dns.disablePrefetch', true);
  options.setPreference('network.trr.mode', 5);
  options.setPreference('network.trr.uri', '');
  options.setPreference('network.dnsCacheExpiration', 0);
  options.setPreference('network.dnsCacheExpirationGracePeriod', 0);
  diag('launching headless Firefox via geckodriver (Builder().build())');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  diag('Firefox launched; configuring timeouts');
  await driver.manage().setTimeouts({ pageLoad: PAGE_LOAD_TIMEOUT_MS, script: 10000 });
  const capabilities = await driver.getCapabilities();
  const profileDir = capabilities.get('moz:profile');
  if (typeof profileDir !== 'string' || profileDir === '') {
    throw new Error('Firefox did not expose a moz:profile path for extension warmup');
  }
  diag(`profile=${profileDir}; waiting for extension UUID in prefs.js`);
  const firefoxExtensionWarmup = await waitForFirefoxExtensionRuntimeReady({
    driver,
    profileDir,
    extensionId: expectedExtensionId,
  }).catch((error) => ({
    ready: false,
    expectedExtensionId,
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
  return { driver, profileDir, firefoxExtensionWarmup };
}

async function launchFirefox(originUrl) {
  const opened = await openUrlWithTransientBrowserRetry({
    url: originUrl,
    maxAttempts: 3,
    createSession: createFirefoxSession,
    openSessionUrl: async (session, url) => {
      await session.driver.get(url);
    },
    closeSession: async (session) => {
      await session.driver.quit();
    },
    onTransientError: (error, { attempt, maxAttempts }) => {
      console.error(
        `Linux AJAX canary discarded Firefox browsing context on page load attempt ${attempt}/${maxAttempts}; retrying with a fresh browser session: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    },
  });

  const session = opened.session;
  if (!session) {
    throw new Error(opened.error ?? 'Firefox did not create a Selenium session');
  }

  const firstPageLoadCompleted = opened.opened === true;
  const firstPageLoadError = opened.opened ? null : opened.error;
  if (!firstPageLoadCompleted) {
    console.error(
      `Linux AJAX canary page load did not complete within ${PAGE_LOAD_TIMEOUT_MS}ms: ${
        firstPageLoadError
      }`
    );
  }

  return {
    driver: session.driver,
    firstPageLoadCompleted,
    firstPageLoadError,
    profileDir: session.profileDir,
    firefoxExtensionWarmup: session.firefoxExtensionWarmup,
    firstPageLoadAttempt: opened.attempt,
  };
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

async function pinWhitelistedAutoAllowHostsLocally() {
  // ROOT CAUSE FIX for the page-observer boundary: the auto-allow test hosts are
  // `*.127.0.0.1.sslip.io` (they encode 127.0.0.1). Resolving them through the
  // agent's dnsmasq forwards `sslip.io` to the runner's upstream, which is flaky
  // / rate-limited under the canary's many queries and returns EAI_AGAIN ->
  // Firefox NS_ERROR_UNKNOWN_HOST -> "Server Not Found" -> the origin page never
  // renders -> no page-resource observer (and pageObserverInstalled stays false).
  // Pin the whitelisted auto-allow hosts to 127.0.0.1 in /etc/hosts (nsswitch
  // "files" before "dns") so they resolve reliably. The non-whitelisted
  // ajax-observe-* hosts are intentionally NOT pinned, so dnsmasq still sinkholes
  // them -- that is the actual no-auto-allow contract under test.
  let whitelistContents = '';
  try {
    whitelistContents = await readFile(WHITELIST_PATH, 'utf8');
  } catch (error) {
    console.error(
      `CANARY_DIAG host-pin: could not read whitelist ${WHITELIST_PATH} (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return;
  }
  const hosts = [
    ...new Set(whitelistContents.match(/ajax-auto-allow-[a-z]+\.127\.0\.0\.1\.sslip\.io/g) ?? []),
  ];
  for (const host of hosts) {
    try {
      await execFileAsync('sudo', [
        'bash',
        '-c',
        `grep -qE '[[:space:]]${host}\\$' /etc/hosts || printf '127.0.0.1 %s\\n' '${host}' >> /etc/hosts`,
      ]);
    } catch (error) {
      console.error(
        `CANARY_DIAG host-pin: failed to pin ${host} (${
          error instanceof Error ? error.message : String(error)
        })`
      );
    }
  }
  if (hosts.length > 0) {
    console.error(
      `CANARY_DIAG host-pin: ensured ${hosts.length} whitelisted auto-allow host(s) resolve to 127.0.0.1 via /etc/hosts (${hosts.join(
        ', '
      )})`
    );
  }
}

async function main() {
  const progress = createAjaxAutoAllowCanaryRuntimeProgress({ canary: 'linux-ajax' });
  progress('bootstrap', 'started', { message: 'Starting Linux AJAX auto-allow canary' });
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  const expectedHosts = [
    ORIGIN_HOST,
    ...LINUX_AUTO_ALLOW_ALL_PROBES.map((probe) => probe.expectedWhitelistHost),
  ];
  const { state, server } = createCanaryServer();
  await listenAjaxAutoAllowCanaryRuntimeServer(server, { port: PORT });
  progress('bootstrap', 'passed', { boundaryId: 'none' });

  let firefoxSession = null;
  const enrollmentSeed = await waitForEnrollmentSeed();
  const originDnsReady = await waitForOriginDnsReady();
  await pinWhitelistedAutoAllowHostsLocally();
  const originPreflight = await collectOriginPreflight(originUrl);
  const preflight = {
    ...(await collectLinuxAutoAllowDiagnostics('preflight', expectedHosts)),
    enrollmentSeed,
    originDnsReady,
    originPreflight,
  };
  try {
    firefoxSession = await launchFirefox(originUrl);
    if (firefoxSession.firefoxExtensionWarmup?.ready === true) {
      progress('firefox-extension-ready', 'passed', { boundaryId: 'none' });
    } else {
      progress('firefox-extension-ready', 'failed', {
        boundaryId: 'firefox-extension-ready',
        message: firefoxSession.firefoxExtensionWarmup?.error ?? 'Firefox extension warmup failed',
      });
    }
    const browserNavigationBeforeAttempts = await waitForPageObserver(
      firefoxSession.driver,
      originUrl
    );
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        hasAllAjaxAutoAllowProbesCompleted(LINUX_AUTO_ALLOW_ALL_PROBES, state.completedProbes) &&
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
      LINUX_AUTO_ALLOW_ALL_PROBES,
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
    const probeEvidence = LINUX_AUTO_ALLOW_ALL_PROBES.map((probe) => ({
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
    const preliminarySuccess =
      hasAllAjaxAutoAllowProbesCompleted(LINUX_AUTO_ALLOW_ALL_PROBES, completedProbesFromTraffic) &&
      pageObserverInstalled &&
      browserPageOutcome.success;
    const baseSummary = {
      originHost: ORIGIN_HOST,
      originUrl,
      expectedExtensionId:
        firefoxSession.firefoxExtensionWarmup?.expectedExtensionId ?? EXPECTED_EXTENSION_ID,
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
      diagnostics: { preflight, postAttempt },
      artifactWritten: true,
    };
    const preliminarySummary = withLinuxAutoAllowDiagnostics({
      ...baseSummary,
      success: preliminarySuccess,
      error: preliminarySuccess ? null : LINUX_AJAX_AUTO_ALLOW_FAILURE_MESSAGE,
      redditDiagnostics: null,
      failureDebug: null,
    });
    const success = preliminarySummary.failureBoundary?.id === 'none';
    const failureDebug = success ? null : await collectLinuxFailureDebugSnapshot();
    const redditDiagnostics = await collectRedditDiagnostics(
      success ? 'post-success' : 'post-failure',
      {
        completedRedditDiagnosticEvents,
        pageResourceCandidateEvents,
      }
    );
    const summary = withLinuxAutoAllowDiagnostics({
      ...baseSummary,
      success,
      error: success ? null : LINUX_AJAX_AUTO_ALLOW_FAILURE_MESSAGE,
      redditDiagnostics,
      failureDebug,
    });

    await emitAjaxAutoAllowCanaryRuntimeSummary({
      summary,
      artifactPath: ARTIFACT_PATH,
      summaryPrefix: 'LINUX_AJAX_AUTO_ALLOW_CANARY_SUMMARY',
      resultOutputKey: 'linux_ajax_auto_allow_result',
      failureBoundaryOutputs: true,
      progress,
      summaryOutputStream: () => 'error',
    });
    if (!success) throw new LinuxAjaxAutoAllowFunctionalFailure(summary.error);
  } finally {
    await firefoxSession?.driver?.quit().catch(() => {});
    await rm(firefoxSession?.profileDir ?? '', { recursive: true, force: true }).catch(() => {});
    server.close();
  }
}

export async function runLinuxAjaxAutoAllowCanaryRuntime() {
  return main();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinuxAjaxAutoAllowCanaryRuntime().catch(async (error) => {
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
}
