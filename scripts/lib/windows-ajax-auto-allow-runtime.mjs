import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
  WINDOWS_AUTO_ALLOW_ALL_PROBES,
  WINDOWS_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  WINDOWS_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  assertWindowsAutoAllowCanarySuccess,
  buildWindowsAutoAllowCanarySummary,
  redactSensitiveWindowsCanaryValue,
  redactWindowsCanaryObject,
} from './windows-auto-allow-canary-evidence.mjs';
import { buildAjaxAutoAllowProbeUrl } from './ajax-auto-allow-canary-harness.mjs';
import {
  createAjaxAutoAllowCanaryRuntimeProgress,
  createAjaxAutoAllowCanaryRuntimeServer,
  emitAjaxAutoAllowCanaryRuntimeSummary,
  listenAjaxAutoAllowCanaryRuntimeServer,
} from './ajax-auto-allow-canary-runtime.mjs';
import {
  evidenceContainsAllExpectedHosts,
  waitForEvidenceObservation,
} from './auto-allow-observation.mjs';
const PORT = Number.parseInt(process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18088', 10);
const TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000',
  10
);
const FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_WARMUP_TIMEOUT_MS ?? '60000',
  10
);
const REMOTE_WHITELIST_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_REMOTE_WHITELIST_TIMEOUT_MS ?? '10000',
  10
);
const POST_FAILURE_OBSERVATION_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS ?? '0',
  10
);
const POST_SUCCESS_OBSERVATION_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_POST_SUCCESS_OBSERVATION_MS ?? '90000',
  10
);
const MAX_ATTEMPT_EVIDENCE = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_MAX_ATTEMPT_EVIDENCE ?? '60',
  10
);
const PROBE_TIMEOUT_MS = 4000;
const XHR_PROBE_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_XHR_PROBE_TIMEOUT_MS ?? '20000',
  10
);
const REDDIT_DIAGNOSTIC_TIMEOUT_MS = 1500;
const REDDIT_DIAGNOSTIC_RETRY_DELAY_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS ?? '2500',
  10
);
const REDDIT_NAVIGATION_MODE = process.env.WINDOWS_AJAX_REDDIT_NAVIGATION_MODE ?? 'off';
const REDDIT_NAVIGATION_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS ?? '45000',
  10
);
const EXPECTED_EXTENSION_ID = process.env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath';
const OPENPATH_ROOT = process.env.OPENPATH_ROOT ?? 'C:\\OpenPath';
const WHITELIST_PATH = process.env.OPENPATH_WHITELIST_PATH ?? 'C:\\OpenPath\\data\\whitelist.txt';
const NATIVE_ROOT =
  process.env.OPENPATH_FIREFOX_NATIVE_ROOT ??
  join(OPENPATH_ROOT, 'browser-extension', 'firefox', 'native');
const NATIVE_STATE_PATH = join(NATIVE_ROOT, 'native-state.json');
const NATIVE_MANIFEST_PATH = join(NATIVE_ROOT, 'whitelist_native_host.json');
const NATIVE_LOG_PATH = join(NATIVE_ROOT, 'native-host.log');
const NATIVE_WHITELIST_PATH = join(NATIVE_ROOT, 'whitelist.txt');
const NATIVE_HOST_SCRIPT_PATH = join(NATIVE_ROOT, 'OpenPath-NativeHost.ps1');
const OPENPATH_LOG_PATH = join(OPENPATH_ROOT, 'data', 'logs', 'openpath.log');
const ARTIFACT_PATH =
  process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT ??
  'production-windows-ajax-auto-allow-canary.json';
const CANARY_API_URL = (process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL ?? '').replace(
  /\/$/,
  ''
);
const CANARY_GROUP_ID = process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID ?? '';
const CANARY_ADMIN_TOKEN = process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN ?? '';
const FIREFOX_MODE = process.env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE ?? 'managed';
const LOCAL_ADDON_PATH = process.env.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH ?? '';
const GECKODRIVER_PATH = process.env.GECKODRIVER_PATH ?? '';
const USE_LOCAL_FIREFOX_ADDON = LOCAL_ADDON_PATH.trim().length > 0;
const USE_SELENIUM_FIREFOX = FIREFOX_MODE === 'selenium' || USE_LOCAL_FIREFOX_ADDON;

function windowsJoin(root, ...parts) {
  return [String(root).replace(/[\\/]+$/, ''), ...parts].join('\\');
}

export function createWindowsAjaxAutoAllowRuntimeConfig(env = process.env) {
  const openPathRoot = env.OPENPATH_ROOT ?? 'C:\\OpenPath';
  const nativeRoot =
    env.OPENPATH_FIREFOX_NATIVE_ROOT ??
    windowsJoin(openPathRoot, 'browser-extension', 'firefox', 'native');
  const localAddonPath = env.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH ?? '';
  const firefoxMode = env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE ?? 'managed';

  return {
    port: Number.parseInt(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18088', 10),
    timeoutMs: Number.parseInt(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000', 10),
    firefoxWarmupTimeoutMs: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_WARMUP_TIMEOUT_MS ?? '60000',
      10
    ),
    remoteWhitelistTimeoutMs: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_REMOTE_WHITELIST_TIMEOUT_MS ?? '10000',
      10
    ),
    postFailureObservationMs: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS ?? '0',
      10
    ),
    postSuccessObservationMs: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_POST_SUCCESS_OBSERVATION_MS ?? '90000',
      10
    ),
    maxAttemptEvidence: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_MAX_ATTEMPT_EVIDENCE ?? '60',
      10
    ),
    redditDiagnosticRetryDelayMs: Number.parseInt(
      env.WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS ?? '2500',
      10
    ),
    redditNavigationMode: env.WINDOWS_AJAX_REDDIT_NAVIGATION_MODE ?? 'off',
    redditNavigationTimeoutMs: Number.parseInt(
      env.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS ?? '45000',
      10
    ),
    xhrProbeTimeoutMs: Number.parseInt(
      env.WINDOWS_AJAX_AUTO_ALLOW_XHR_PROBE_TIMEOUT_MS ?? '20000',
      10
    ),
    expectedExtensionId: env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath',
    openPathRoot,
    whitelistPath:
      env.OPENPATH_WHITELIST_PATH ?? windowsJoin(openPathRoot, 'data', 'whitelist.txt'),
    nativeRoot,
    nativeStatePath: windowsJoin(nativeRoot, 'native-state.json'),
    nativeManifestPath: windowsJoin(nativeRoot, 'whitelist_native_host.json'),
    nativeLogPath: windowsJoin(nativeRoot, 'native-host.log'),
    nativeWhitelistPath: windowsJoin(nativeRoot, 'whitelist.txt'),
    nativeHostScriptPath: windowsJoin(nativeRoot, 'OpenPath-NativeHost.ps1'),
    openPathLogPath: windowsJoin(openPathRoot, 'data', 'logs', 'openpath.log'),
    artifactPath:
      env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT ??
      'production-windows-ajax-auto-allow-canary.json',
    canaryApiUrl: (env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL ?? '').replace(/\/$/, ''),
    canaryGroupId: env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID ?? '',
    canaryAdminToken: env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN ?? '',
    firefoxMode,
    localAddonPath,
    geckodriverPath: env.GECKODRIVER_PATH ?? '',
    useLocalFirefoxAddon: localAddonPath.trim().length > 0,
    useSeleniumFirefox: firefoxMode === 'selenium' || localAddonPath.trim().length > 0,
    probes: WINDOWS_AUTO_ALLOW_ALL_PROBES,
    redditDiagnosticProbes: REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
  };
}

async function runInjectedRuntime(config, adapters) {
  const progress = createAjaxAutoAllowCanaryRuntimeProgress({
    canary: 'windows-ajax',
    output: (line) => adapters.output.error?.(line),
  });
  progress('bootstrap', 'started', { message: 'Starting Windows AJAX auto-allow canary' });
  const firefoxPath = adapters.browser.findFirefox(config);
  const targetUrl = buildProbeUrl(config.probes[0], config.port);
  const assetUrl = buildProbeUrl(config.probes[1], config.port);
  const server = await adapters.server.createProbeServer(config);
  progress('bootstrap', 'passed', { boundaryId: 'none' });
  const state = server.state;
  let managedPolicySuspension = null;
  let profileDir = null;

  try {
    const preflightDiagnostics = await adapters.diagnostics.collectWindows('preflight', config);
    profileDir = await adapters.filesystem.makeProfileDir(config);
    const firefoxExtensionWarmup = config.useSeleniumFirefox
      ? await (async () => {
          managedPolicySuspension = config.useLocalFirefoxAddon
            ? await adapters.policy.suspendFirefoxEnterprisePolicy(firefoxPath, config)
            : null;
          const session = await adapters.browser.launchFirefoxWithSelenium({
            firefoxPath,
            profileDir,
            originUrl: `http://${ORIGIN_HOST}:${config.port}/`,
            config,
          });
          return config.useLocalFirefoxAddon
            ? { ...session.firefoxExtensionWarmup, managedPolicySuspension }
            : session.firefoxExtensionWarmup;
        })()
      : await adapters.browser.waitForFirefoxExtensionReady({ firefoxPath, profileDir, config });

    if (!firefoxExtensionWarmup.ready) {
      progress('firefox-extension-ready', 'failed', {
        boundaryId: 'firefox-extension-ready',
        message: 'Firefox extension warmup failed',
      });
      const summary = buildWindowsAutoAllowCanarySummary({
        result: {
          success: false,
          error: `Timed out after ${config.firefoxWarmupTimeoutMs}ms waiting for Firefox extension ${config.expectedExtensionId} to be ready`,
          targetUrl,
          assetUrl,
          pageObserverInstalled: false,
        },
        probeEvidence: config.probes.map((probe) => ({
          id: probe.id,
          kind: probe.kind,
          host: probe.host,
          url: buildProbeUrl(probe, config.port),
          hits: 0,
          expectedWhitelistHost: probe.expectedWhitelistHost,
          whitelistContainsExpectedHost: false,
        })),
        originHits: state.originHits ?? 0,
        attempts: state.browserAttempts ?? [],
        completedProbes: state.completedProbes ?? {},
        completedCandidateEvents: state.completedCandidateEvents ?? {},
        completedRedditDiagnosticEvents: state.completedRedditDiagnosticEvents ?? {},
        pageResourceCandidateEvents: state.pageResourceCandidateEvents ?? [],
        lastAttemptAt: state.lastAttemptAt ?? null,
        whitelistPath: config.whitelistPath,
        firefoxExtensionWarmup,
        firefoxOutput: '',
        diagnostics: {
          preflight: preflightDiagnostics,
          postFailure: await adapters.diagnostics.collectWindows(
            'post-firefox-warmup-failure',
            config
          ),
        },
      });

      await emitAjaxAutoAllowCanaryRuntimeSummary({
        summary,
        artifactPath: config.artifactPath,
        summaryPrefix: 'WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY',
        resultOutputKey: 'windows_ajax_auto_allow_result',
        emitArtifactProgress: false,
        output: adapters.output,
        githubOutput: adapters.output.githubOutput,
        writeArtifact: adapters.filesystem.writeArtifact,
        summaryOutputStream: () => 'error',
      });
      throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
    }

    progress('firefox-extension-ready', 'passed', { boundaryId: 'none' });

    throw new Error('Injected Windows AJAX runtime success path is not implemented');
  } finally {
    server.close();
    if (profileDir) {
      await adapters.filesystem.removeProfileDir(profileDir, config).catch(() => {});
    }
    await adapters.policy
      .restoreFirefoxEnterprisePolicy(managedPolicySuspension, config)
      .catch(() => {});
  }
}

function findFirefox() {
  const unsignedAddonCandidates = [
    process.env.FIREFOX_PATH,
    'C:\\Program Files\\Firefox Developer Edition\\firefox.exe',
    'C:\\Program Files\\Firefox Nightly\\firefox.exe',
  ].filter(Boolean);
  const releaseCandidates = [
    process.env.FIREFOX_PATH,
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  ].filter(Boolean);
  const candidates = USE_LOCAL_FIREFOX_ADDON ? unsignedAddonCandidates : releaseCandidates;

  const firefoxPath = candidates.find((candidate) => existsSync(candidate));
  if (!firefoxPath) {
    throw new Error('Firefox Release is not available for the Windows AJAX auto-allow canary');
  }

  return firefoxPath;
}

function buildProbeUrl(probe, port = PORT) {
  return buildAjaxAutoAllowProbeUrl(probe, port);
}

function createWindowsAjaxCanaryHarness({
  port = PORT,
  timeoutMs = TIMEOUT_MS,
  maxAttemptEvidence = MAX_ATTEMPT_EVIDENCE,
  probes = WINDOWS_AUTO_ALLOW_ALL_PROBES,
  redditDiagnosticProbes = REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
  redditDiagnosticRetryDelayMs = REDDIT_DIAGNOSTIC_RETRY_DELAY_MS,
  onResult,
} = {}) {
  // The shared harness owns browser probe details formerly in this runtime:
  // Access-Control-Allow-Origin, fetch(, new Image(), document.createElement('script'),
  // document.createElement('link'), loadFont, loadStylesheetFont, @font-face, fontFamily,
  // /probe-state?probe=, withTimeout(runProbeOnce(probe), req.url === '/attempt',
  // reportAttempt(attemptResult, completed), and font/woff2.
  return createAjaxAutoAllowCanaryRuntimeServer({
    platformAdapter: {
      label: 'Windows',
      probes,
      redditDiagnosticProbes,
      originHost: ORIGIN_HOST,
      stateGlobalName: '__openpathWindowsAjaxCanaryState',
      scriptGlobalName: '__openpathAjaxAutoAllowScriptProbe',
      stylesheetCss: 'body { --openpath-ajax-auto-allow-style-probe: loaded; }',
      statusElement: true,
      redact: redactWindowsCanaryObject,
    },
    port,
    timeoutMs,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    xhrTimeoutMs: XHR_PROBE_TIMEOUT_MS,
    redditDiagnosticTimeoutMs: REDDIT_DIAGNOSTIC_TIMEOUT_MS,
    redditDiagnosticRetryDelayMs,
    maxAttemptEvidence,
    onResult,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTextIfExists(path, maxChars = 4000) {
  try {
    const contents = await readFile(path, 'utf8');
    return redactSensitiveWindowsCanaryValue(contents.slice(-maxChars));
  } catch (error) {
    return {
      unavailable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readJsonIfExists(path) {
  try {
    return redactWindowsCanaryObject(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    return {
      unavailable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

async function waitForLocalWhitelistObservation(expectedHosts = [], timeoutMs = 0) {
  const result = await waitForEvidenceObservation({
    expectedHosts,
    timeoutMs,
    collectors: {
      global: () => readFileEvidence(WHITELIST_PATH, expectedHosts),
      native: () => readFileEvidence(NATIVE_WHITELIST_PATH, expectedHosts),
    },
  });
  return {
    observed: result.observed,
    timeoutMs: result.timeoutMs,
    elapsedMs: result.elapsedMs,
    global: result.evidence.global,
    native: result.evidence.native,
  };
}

async function collectRemoteWhitelistEvidence(expectedHosts = []) {
  let whitelistUrl = '';
  try {
    const nativeState = JSON.parse(await readFile(NATIVE_STATE_PATH, 'utf8'));
    whitelistUrl = typeof nativeState?.whitelistUrl === 'string' ? nativeState.whitelistUrl : '';
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!whitelistUrl) {
    return {
      available: false,
      error: 'native-state whitelistUrl missing',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_WHITELIST_TIMEOUT_MS);
  try {
    const response = await fetch(whitelistUrl, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const contents = await response.text();
    const lowerContents = contents.toLowerCase();
    return {
      available: true,
      fetched: true,
      url: redactSensitiveWindowsCanaryValue(whitelistUrl),
      status: response.status,
      ok: response.ok,
      size: contents.length,
      containsExpectedHosts: Object.fromEntries(
        expectedHosts.map((host) => [host, lowerContents.includes(host.toLowerCase())])
      ),
    };
  } catch (error) {
    return {
      available: true,
      fetched: false,
      url: redactSensitiveWindowsCanaryValue(whitelistUrl),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function collectCanaryGroupDiagnostics(expectedHosts = []) {
  if (!CANARY_API_URL || !CANARY_GROUP_ID || !CANARY_ADMIN_TOKEN) {
    return {
      available: false,
      error:
        'WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL, WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID, or WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN missing',
    };
  }

  let diagnosticsUrl;
  try {
    diagnosticsUrl = new URL(
      `/cp/internal/client-canary/group/${encodeURIComponent(CANARY_GROUP_ID)}/diagnostics`,
      CANARY_API_URL
    );
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  for (const host of expectedHosts) {
    diagnosticsUrl.searchParams.append('host', host);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_WHITELIST_TIMEOUT_MS);
  try {
    const response = await fetch(diagnosticsUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${CANARY_ADMIN_TOKEN}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: redactSensitiveWindowsCanaryValue(text.slice(-4000)) };
    }

    return redactWindowsCanaryObject({
      available: true,
      fetched: true,
      url: diagnosticsUrl.toString(),
      status: response.status,
      ok: response.ok,
      body,
    });
  } catch (error) {
    return {
      available: true,
      fetched: false,
      url: diagnosticsUrl.toString(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function canaryGroupDiagnosticsContainsAllExpectedHosts(diagnostics, expectedHosts = []) {
  const expectedHostState = diagnostics?.body?.expectedHostState;
  if (!expectedHostState || typeof expectedHostState !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => expectedHostState[host]?.whitelistRulePresent === true);
}

async function waitForRemoteRuleObservation(expectedHosts = [], timeoutMs = 0) {
  const result = await waitForEvidenceObservation({
    expectedHosts,
    timeoutMs,
    collectors: {
      diagnostics: () => collectCanaryGroupDiagnostics(expectedHosts),
    },
    matches: canaryGroupDiagnosticsContainsAllExpectedHosts,
  });
  return {
    observed: result.observed,
    timeoutMs: result.timeoutMs,
    elapsedMs: result.elapsedMs,
    diagnostics: result.evidence.diagnostics,
  };
}

function runPowerShell(args, { input, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const powershell = spawn(process.env.PWSH_PATH ?? 'powershell.exe', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = '';
    const timeout = setTimeout(() => {
      powershell.kill('SIGTERM');
      resolve({
        success: false,
        timedOut: true,
        stdout: '',
        stdoutBuffer: Buffer.alloc(0),
        stderr: stderr.slice(-4000),
      });
    }, timeoutMs);

    powershell.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    });
    powershell.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    powershell.once('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: error.message,
        stdout: '',
        stdoutBuffer: Buffer.alloc(0),
        stderr: stderr.slice(-4000),
      });
    });
    powershell.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        code,
        signal,
        stdout: stdout.toString('utf8'),
        stdoutBuffer: stdout,
        stderr: stderr.slice(-4000),
      });
    });

    if (input) {
      powershell.stdin.write(input);
    }
    powershell.stdin.end();
  });
}

async function readScheduledTaskEvidence(taskName = 'OpenPath-Update') {
  const escapedTaskName = String(taskName).replace(/'/g, "''");
  const command = `
$task = Get-ScheduledTask -TaskName '${escapedTaskName}' -ErrorAction SilentlyContinue
$info = Get-ScheduledTaskInfo -TaskName '${escapedTaskName}' -ErrorAction SilentlyContinue
[pscustomobject]@{
  taskName = '${escapedTaskName}'
  present = $null -ne $task
  state = if ($task) { [string]$task.State } else { '' }
  lastRunTime = if ($info) { [string]$info.LastRunTime } else { '' }
  lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
  nextRunTime = if ($info) { [string]$info.NextRunTime } else { '' }
} | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeoutMs: 10000 }
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? result.stderr ?? `PowerShell exited ${String(result.code)}`,
    };
  }

  try {
    return { success: true, ...JSON.parse(result.stdout) };
  } catch {
    return { success: false, raw: redactSensitiveWindowsCanaryValue(result.stdout) };
  }
}

function parseKeyValueTimingLine(line) {
  const fields = {};
  for (const match of String(line ?? '').matchAll(/\b([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g)) {
    const [, key, value] = match;
    fields[key] = /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
  }
  return fields;
}

function extractRuntimeDependencyTimingEvidence(nativeLogTail, openPathLogTail) {
  const nativeLines = String(nativeLogTail ?? '')
    .split(/\r?\n/)
    .filter((line) => line.includes('Native host action='));
  const nativeActions = nativeLines
    .map((line) => ({ line, fields: parseKeyValueTimingLine(line) }))
    .filter((entry) =>
      [
        'allow-local-runtime-dependency',
        'allow-local-runtime-dependency-batch',
        'update-whitelist',
      ].includes(String(entry.fields.action ?? ''))
    )
    .slice(-20);
  const latestNativeAction = [...nativeActions]
    .reverse()
    .find((entry) =>
      String(entry.fields.action ?? '').startsWith('allow-local-runtime-dependency')
    );
  const latestUpdateAction = [...nativeActions]
    .reverse()
    .find((entry) => entry.fields.action === 'update-whitelist');
  const fastApplyLine = String(openPathLogTail ?? '')
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.includes('Runtime dependency fast apply metrics:'));
  const fastApplyMetrics = fastApplyLine ? parseKeyValueTimingLine(fastApplyLine) : null;

  return redactWindowsCanaryObject({
    variant: fastApplyMetrics ? 'fast-queue-apply-product' : 'baseline-current',
    nativeActionElapsedMs: latestNativeAction?.fields?.elapsedMs ?? null,
    queueWriteMs: latestNativeAction?.fields?.queueWriteMs ?? null,
    updateTriggerMs: latestUpdateAction?.fields?.updateTriggerMs ?? null,
    updateWaitMs: latestUpdateAction?.fields?.updateWaitMs ?? null,
    queueProcessedMs: fastApplyMetrics?.queueProcessedMs ?? null,
    queueProcessed: fastApplyMetrics?.processed ?? null,
    queueRejected: fastApplyMetrics?.rejected ?? null,
    overlayWriteMs: fastApplyMetrics?.overlayWriteMs ?? null,
    acrylicHostUpdateMs: fastApplyMetrics?.acrylicHostUpdateMs ?? null,
    acrylicReloadMs: fastApplyMetrics?.acrylicReloadMs ?? null,
    fastApplyMetrics,
    nativeActions,
  });
}

async function sendNativeProtocolMessage(message) {
  if (!existsSync(NATIVE_HOST_SCRIPT_PATH)) {
    return { success: false, error: `${NATIVE_HOST_SCRIPT_PATH} is not present` };
  }

  const messageBytes = Buffer.from(JSON.stringify(message), 'utf8');
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeInt32LE(messageBytes.length, 0);
  const result = await runPowerShell(
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', NATIVE_HOST_SCRIPT_PATH],
    { input: Buffer.concat([lengthBytes, messageBytes]), timeoutMs: 15000 }
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? result.stderr ?? `Native host exited ${String(result.code)}`,
    };
  }

  const stdout = result.stdoutBuffer ?? Buffer.from(result.stdout, 'binary');
  if (stdout.length < 4) {
    return { success: false, error: 'Native host returned no framed response' };
  }

  const responseLength = stdout.readInt32LE(0);
  const responseBody = stdout.subarray(4, 4 + responseLength).toString('utf8');
  try {
    const response = JSON.parse(responseBody);
    if (response?.action === 'get-machine-token') {
      return {
        success: response.success === true,
        action: response.action,
        tokenPresent: typeof response.token === 'string' && response.token.length > 0,
        ...(response.error ? { error: response.error } : {}),
      };
    }

    return redactWindowsCanaryObject(response);
  } catch {
    return {
      success: false,
      error: 'Native host returned invalid JSON',
      raw: redactSensitiveWindowsCanaryValue(responseBody),
    };
  }
}

async function collectWindowsAutoAllowDiagnostics(phase) {
  const expectedHosts = WINDOWS_AUTO_ALLOW_ALL_PROBES.map((probe) => probe.expectedWhitelistHost);
  const [
    globalWhitelist,
    nativeWhitelist,
    nativeState,
    nativeLogTail,
    openPathLogTail,
    updateTask,
    runtimeDependencyApplyTask,
    sseTask,
    remoteWhitelist,
    canaryGroup,
  ] = await Promise.all([
    readFileEvidence(WHITELIST_PATH, expectedHosts),
    readFileEvidence(NATIVE_WHITELIST_PATH, expectedHosts),
    readJsonIfExists(NATIVE_STATE_PATH),
    readTextIfExists(NATIVE_LOG_PATH),
    readTextIfExists(OPENPATH_LOG_PATH),
    readScheduledTaskEvidence('OpenPath-Update'),
    readScheduledTaskEvidence('OpenPath-RuntimeDependencyApply'),
    readScheduledTaskEvidence('OpenPath-SSE'),
    collectRemoteWhitelistEvidence(expectedHosts),
    collectCanaryGroupDiagnostics(expectedHosts),
  ]);
  const [ping, getConfig, getHostname, getMachineToken, check] = await Promise.all([
    sendNativeProtocolMessage({ action: 'ping' }),
    sendNativeProtocolMessage({ action: 'get-config' }),
    sendNativeProtocolMessage({ action: 'get-hostname' }),
    sendNativeProtocolMessage({ action: 'get-machine-token' }),
    sendNativeProtocolMessage({
      action: 'check',
      domains: [ORIGIN_HOST, ...expectedHosts],
    }),
  ]);
  const nativeProtocol = {
    ping,
    getConfig,
    getHostname,
    getMachineToken,
    check,
  };

  return redactWindowsCanaryObject({
    phase,
    collectedAt: new Date().toISOString(),
    openPathRoot: OPENPATH_ROOT,
    whitelist: {
      global: globalWhitelist,
      native: nativeWhitelist,
      remoteWhitelist,
    },
    remoteWhitelist,
    nativeHost: {
      root: NATIVE_ROOT,
      statePath: NATIVE_STATE_PATH,
      statePresent: existsSync(NATIVE_STATE_PATH),
      state: nativeState,
      manifestPath: NATIVE_MANIFEST_PATH,
      manifestPresent: existsSync(NATIVE_MANIFEST_PATH),
      scriptPath: NATIVE_HOST_SCRIPT_PATH,
      scriptPresent: existsSync(NATIVE_HOST_SCRIPT_PATH),
      logPath: NATIVE_LOG_PATH,
      logTail: nativeLogTail,
      openPathLogPath: OPENPATH_LOG_PATH,
      openPathLogTail,
      tasks: {
        update: updateTask,
        runtimeDependencyApply: runtimeDependencyApplyTask,
        sse: sseTask,
      },
      taskName: 'OpenPath-Update',
      task: updateTask,
      runtimeDependencyTiming: extractRuntimeDependencyTimingEvidence(
        nativeLogTail,
        openPathLogTail
      ),
    },
    nativeProtocol,
    server: {
      canaryGroup,
    },
  });
}

async function collectRedditDiagnostics(phase, pageEvidence = {}, navigationEvidence = null) {
  const [globalWhitelist, nativeWhitelist, remoteWhitelist, canaryGroup] = await Promise.all([
    readFileEvidence(WHITELIST_PATH, REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
    readFileEvidence(NATIVE_WHITELIST_PATH, REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
    collectRemoteWhitelistEvidence(REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
    collectCanaryGroupDiagnostics(REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS),
  ]);

  return redactWindowsCanaryObject({
    phase,
    collectedAt: new Date().toISOString(),
    hosts: REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
    probes: REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
    page: pageEvidence,
    navigation:
      navigationEvidence ??
      buildRedditNavigationSkippedEvidence(REDDIT_NAVIGATION_MODE, pageEvidence),
    whitelist: {
      global: globalWhitelist,
      native: nativeWhitelist,
      remoteWhitelist,
    },
    remoteWhitelist,
    server: {
      canaryGroup,
    },
  });
}

function normalizeRedditNavigationMode(mode) {
  return ['off', 'diagnostic', 'gate'].includes(mode) ? mode : 'off';
}

function buildRedditNavigationSkippedEvidence(mode, pageEvidence = {}) {
  return {
    mode: normalizeRedditNavigationMode(mode),
    url: 'https://www.reddit.com/',
    success: null,
    blockedByOpenPath: false,
    timedOut: false,
    metrics: null,
    resourceHosts: [],
    errors: [],
    firstPass: pageEvidence?.firstPass ?? pageEvidence?.probes ?? null,
    secondPass: pageEvidence?.secondPass ?? null,
  };
}

function collectNavigationMetricsScript() {
  return `
const navigation = performance.getEntriesByType('navigation')[0];
const resources = performance.getEntriesByType('resource')
  .map((entry) => {
    try { return new URL(entry.name).hostname; } catch { return ''; }
  })
  .filter(Boolean);
const resourceHosts = [...new Set(resources)].filter((host) =>
  host === 'reddit.com' || host.endsWith('.reddit.com') ||
  host === 'redd.it' || host.endsWith('.redd.it') ||
  host === 'redditmedia.com' || host.endsWith('.redditmedia.com') ||
  host === 'redditstatic.com' || host.endsWith('.redditstatic.com')
);
const text = document.body ? document.body.innerText.slice(0, 4000) : '';
const title = document.title || '';
const href = location.href;
const blockedByOpenPath =
  /openpath/i.test(text + ' ' + title) &&
  /(blocked|bloquead|request access|solicitar acceso|whitelist|allowlist)/i.test(text + ' ' + title + ' ' + href);
const timeOrigin = Math.round(performance.timeOrigin || Date.now() - performance.now());
return {
  href,
  title,
  readyState: document.readyState,
  blockedByOpenPath,
  metrics: navigation ? {
    navigationStart: timeOrigin,
    domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
    loadEventEnd: Math.round(navigation.loadEventEnd),
    duration: Math.round(navigation.duration),
  } : null,
  resourceHosts,
};
`;
}

async function collectBrowserLogErrors(driver) {
  try {
    const entries = await driver.manage().logs().get('browser');
    return entries
      .filter((entry) => /severe|error|warning/i.test(String(entry.level?.name ?? entry.level)))
      .slice(-20)
      .map((entry) => ({
        level: String(entry.level?.name ?? entry.level ?? ''),
        message: String(entry.message ?? '').slice(-1000),
      }));
  } catch (error) {
    return [
      {
        level: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function collectRedditRealNavigationDiagnostics({
  driver,
  mode = REDDIT_NAVIGATION_MODE,
  pageEvidence = {},
  url = 'https://www.reddit.com/',
  timeoutMs = REDDIT_NAVIGATION_TIMEOUT_MS,
}) {
  const normalizedMode = normalizeRedditNavigationMode(mode);
  const base = buildRedditNavigationSkippedEvidence(normalizedMode, pageEvidence);
  if (normalizedMode === 'off') {
    return base;
  }

  const startedAt = Date.now();
  let timedOut = false;
  let navigationError = null;
  try {
    await driver.manage().setTimeouts({ pageLoad: timeoutMs, script: 15_000 });
    await driver.get(url);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
    timedOut = /timeout|Timed out/i.test(navigationError);
  }

  let page = null;
  try {
    page = await driver.executeScript(collectNavigationMetricsScript());
  } catch (error) {
    navigationError = navigationError ?? (error instanceof Error ? error.message : String(error));
  }

  const browserErrors = await collectBrowserLogErrors(driver);
  const errors = [
    ...(navigationError ? [{ message: navigationError }] : []),
    ...browserErrors,
  ].slice(-20);
  const blockedByOpenPath = page?.blockedByOpenPath === true;
  const success = navigationError === null && !timedOut && !blockedByOpenPath;

  return redactWindowsCanaryObject({
    ...base,
    mode: normalizedMode,
    url,
    success,
    blockedByOpenPath,
    timedOut,
    metrics: page?.metrics
      ? {
          ...page.metrics,
          totalDurationMs: Date.now() - startedAt,
          readyState: page.readyState ?? null,
        }
      : {
          totalDurationMs: Date.now() - startedAt,
          readyState: page?.readyState ?? null,
        },
    resourceHosts: Array.isArray(page?.resourceHosts) ? page.resourceHosts : [],
    errors,
    href: page?.href ?? null,
    title: page?.title ?? null,
  });
}

function waitForProcessExit(processHandle, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      resolve({
        code: processHandle.exitCode,
        signal: processHandle.signalCode,
        timedOut: false,
      });
      return;
    }

    const timeout = setTimeout(() => {
      resolve({
        code: processHandle.exitCode,
        signal: processHandle.signalCode,
        timedOut: true,
      });
    }, timeoutMs);

    processHandle.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, timedOut: false });
    });
  });
}

async function readProfileExtensionEvidence(profileDir) {
  const registryPath = join(profileDir, 'extensions.json');
  const profileExtensionPath = join(profileDir, 'extensions', `${EXPECTED_EXTENSION_ID}.xpi`);
  let registryAddon = null;

  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      registryAddon =
        registry?.addons?.find((addon) => addon?.id === EXPECTED_EXTENSION_ID) ?? null;
    } catch {
      registryAddon = null;
    }
  }

  return {
    expectedExtensionId: EXPECTED_EXTENSION_ID,
    registryPath,
    profileExtensionPath,
    registryAddonPresent: registryAddon !== null,
    profileExtensionPresent: existsSync(profileExtensionPath),
    registryAddonActive: registryAddon?.active,
    registryAddonVersion: registryAddon?.version,
  };
}

async function waitForFirefoxExtensionReady({ firefoxPath, profileDir }) {
  const warmup = spawn(
    firefoxPath,
    ['-headless', '-no-remote', '-profile', profileDir, 'about:blank'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  warmup.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  warmup.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS;
  let evidence = await readProfileExtensionEvidence(profileDir);
  while (Date.now() < deadline) {
    evidence = await readProfileExtensionEvidence(profileDir);
    if (evidence.registryAddonPresent || evidence.profileExtensionPresent) {
      break;
    }

    await sleep(2000);
  }

  if (!warmup.killed) {
    warmup.kill('SIGTERM');
  }

  const exit = await waitForProcessExit(warmup);

  return {
    ...evidence,
    ready: evidence.registryAddonPresent || evidence.profileExtensionPresent,
    timeoutMs: FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
    exit,
    firefoxOutput: output.slice(-4000),
  };
}

async function waitForProfileExtensionReady(profileDir) {
  const deadline = Date.now() + FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS;
  let evidence = await readProfileExtensionEvidence(profileDir);
  while (Date.now() < deadline) {
    evidence = await readProfileExtensionEvidence(profileDir);
    if (evidence.registryAddonPresent || evidence.profileExtensionPresent) {
      break;
    }

    await sleep(2000);
  }

  return {
    ...evidence,
    ready: evidence.registryAddonPresent || evidence.profileExtensionPresent,
    timeoutMs: FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
  };
}

async function suspendFirefoxEnterprisePolicy(firefoxPath) {
  const policyPath = join(dirname(firefoxPath), 'distribution', 'policies.json');
  const backupPath = `${policyPath}.openpath-direct-${process.pid}-${Date.now()}.bak`;
  if (!existsSync(policyPath)) {
    return {
      suspended: false,
      policyPath,
      backupPath: null,
    };
  }

  await rename(policyPath, backupPath);
  return {
    suspended: true,
    policyPath,
    backupPath,
  };
}

async function restoreFirefoxEnterprisePolicy(managedPolicySuspension) {
  if (!managedPolicySuspension?.suspended || !managedPolicySuspension.backupPath) {
    return;
  }

  await rm(managedPolicySuspension.policyPath, { force: true }).catch(() => {});
  await rename(managedPolicySuspension.backupPath, managedPolicySuspension.policyPath);
}

async function launchFirefoxWithSelenium({ firefoxPath, profileDir, originUrl }) {
  if (USE_LOCAL_FIREFOX_ADDON && !existsSync(LOCAL_ADDON_PATH)) {
    throw new Error(
      `WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH was not found: ${LOCAL_ADDON_PATH || '<empty>'}`
    );
  }

  const [{ Builder }, firefox] = await Promise.all([
    import('selenium-webdriver'),
    import('selenium-webdriver/firefox.js'),
  ]);

  const options = new firefox.Options();
  options.setBinary(firefoxPath);
  options.setProfile(profileDir);
  options.addArguments('-headless');
  if (USE_LOCAL_FIREFOX_ADDON) {
    options.addExtensions(LOCAL_ADDON_PATH);
  }
  options.setPreference('network.dns.disablePrefetch', true);
  options.setPreference('network.trr.mode', 5);
  options.setPreference('network.trr.uri', '');
  options.setPreference('network.dnsCacheExpiration', 0);
  options.setPreference('network.dnsCacheExpirationGracePeriod', 0);
  options.setPreference('dom.webnotifications.enabled', true);
  options.setPreference('extensions.experiments.enabled', true);
  options.setPreference('xpinstall.signatures.required', false);
  options.setPreference('extensions.langpacks.signatures.required', false);
  options.setPreference('extensions.blocklist.enabled', false);

  let builder = new Builder().forBrowser('firefox').setFirefoxOptions(options);
  if (GECKODRIVER_PATH && existsSync(GECKODRIVER_PATH)) {
    builder = builder.setFirefoxService(new firefox.ServiceBuilder(GECKODRIVER_PATH));
  }

  const driver = await builder.build();
  await driver.manage().setTimeouts({ implicit: 2_000, pageLoad: 30_000, script: 15_000 });

  const capabilities = await driver.getCapabilities();
  const activeProfileDir = capabilities.get('moz:profile') || profileDir;
  const extensionEvidence = await waitForProfileExtensionReady(String(activeProfileDir));

  let initialNavigation = { success: true, error: null };
  try {
    await driver.get(originUrl);
  } catch (error) {
    initialNavigation = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    driver,
    firefoxExtensionWarmup: {
      ...extensionEvidence,
      ready: extensionEvidence.registryAddonPresent || extensionEvidence.profileExtensionPresent,
      mode: USE_LOCAL_FIREFOX_ADDON ? 'selenium-local-addon' : 'selenium-managed',
      localAddonPath: USE_LOCAL_FIREFOX_ADDON ? LOCAL_ADDON_PATH : null,
      geckodriverPath: GECKODRIVER_PATH || null,
      profileDir: activeProfileDir,
      timeoutMs: FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
      initialNavigation,
    },
  };
}

async function readWhitelistContainsHost(host) {
  const contents = await readFile(WHITELIST_PATH, 'utf8');
  return contents.toLowerCase().includes(String(host).toLowerCase());
}

async function main() {
  const progress = createAjaxAutoAllowCanaryRuntimeProgress({ canary: 'windows-ajax' });
  progress('bootstrap', 'started', { message: 'Starting Windows AJAX auto-allow canary' });
  const firefoxPath = findFirefox();
  const targetUrl = buildProbeUrl(AUTO_ALLOW_PROBES[0]);
  const assetUrl = buildProbeUrl(AUTO_ALLOW_PROBES[1]);
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const { state, server } = createWindowsAjaxCanaryHarness({ onResult: resolveResult });

  await listenAjaxAutoAllowCanaryRuntimeServer(server, { port: PORT });
  progress('bootstrap', 'passed', { boundaryId: 'none' });

  const preflightDiagnostics = await collectWindowsAutoAllowDiagnostics('preflight');
  const profileDir = await mkdtemp(join(tmpdir(), 'windows-ajax-auto-allow-firefox-'));
  let firefoxExtensionWarmup;
  let firefox = null;
  let firefoxOutput = '';
  let seleniumDriver = null;
  let managedPolicySuspension = null;

  if (USE_SELENIUM_FIREFOX) {
    managedPolicySuspension = USE_LOCAL_FIREFOX_ADDON
      ? await suspendFirefoxEnterprisePolicy(firefoxPath)
      : null;
    try {
      const seleniumSession = await launchFirefoxWithSelenium({
        firefoxPath,
        profileDir,
        originUrl,
      });
      firefoxExtensionWarmup = USE_LOCAL_FIREFOX_ADDON
        ? {
            ...seleniumSession.firefoxExtensionWarmup,
            managedPolicySuspension,
          }
        : seleniumSession.firefoxExtensionWarmup;
      seleniumDriver = seleniumSession.driver;
    } catch (error) {
      await restoreFirefoxEnterprisePolicy(managedPolicySuspension).catch(() => {});
      throw error;
    }
  } else {
    firefoxExtensionWarmup = await waitForFirefoxExtensionReady({ firefoxPath, profileDir });
  }

  if (!firefoxExtensionWarmup.ready) {
    progress('firefox-extension-ready', 'failed', {
      boundaryId: 'firefox-extension-ready',
      message: 'Firefox extension warmup failed',
    });
    const summary = buildWindowsAutoAllowCanarySummary({
      result: {
        success: false,
        error: `Timed out after ${FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS}ms waiting for Firefox extension ${EXPECTED_EXTENSION_ID} to be ready`,
        targetUrl,
        assetUrl,
        pageObserverInstalled: false,
      },
      probeEvidence: AUTO_ALLOW_PROBES.map((probe) => ({
        id: probe.id,
        kind: probe.kind,
        host: probe.host,
        url: buildProbeUrl(probe),
        hits: 0,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        whitelistContainsExpectedHost: false,
      })),
      originHits: state.originHits,
      attempts: state.browserAttempts,
      completedProbes: state.completedProbes,
      completedCandidateEvents: state.completedCandidateEvents,
      completedRedditDiagnosticEvents: state.completedRedditDiagnosticEvents,
      pageResourceCandidateEvents: state.pageResourceCandidateEvents,
      lastAttemptAt: state.lastAttemptAt,
      whitelistPath: WHITELIST_PATH,
      firefoxExtensionWarmup,
      firefoxOutput,
      diagnostics: {
        preflight: preflightDiagnostics,
        postFailure: await collectWindowsAutoAllowDiagnostics('post-firefox-warmup-failure'),
      },
    });

    await emitAjaxAutoAllowCanaryRuntimeSummary({
      summary,
      artifactPath: ARTIFACT_PATH,
      summaryPrefix: 'WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY',
      resultOutputKey: 'windows_ajax_auto_allow_result',
      emitArtifactProgress: false,
      summaryOutputStream: () => 'error',
    });
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await restoreFirefoxEnterprisePolicy(managedPolicySuspension).catch(() => {});
    throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
  }

  progress('firefox-extension-ready', 'passed', { boundaryId: 'none' });

  if (!USE_SELENIUM_FIREFOX) {
    firefox = spawn(firefoxPath, ['-headless', '-no-remote', '-profile', profileDir, originUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    firefox.stdout.on('data', (chunk) => {
      firefoxOutput += chunk.toString();
    });
    firefox.stderr.on('data', (chunk) => {
      firefoxOutput += chunk.toString();
    });
    firefox.once('exit', (code, signal) => {
      resolveResult({
        success: false,
        error: `Firefox exited before AJAX auto-allow result (code=${String(code)}, signal=${String(signal)})`,
        targetUrl,
        assetUrl,
        attempts: state.browserAttempts,
        completedProbes: state.completedProbes,
        completedCandidateEvents: state.completedCandidateEvents,
        completedRedditDiagnosticEvents: state.completedRedditDiagnosticEvents,
        pageResourceCandidateEvents: state.pageResourceCandidateEvents,
        pageObserverInstalled: state.pageObserverInstalled,
        lastAttemptAt: state.lastAttemptAt,
      });
    });
  }

  const timeout = setTimeout(() => {
    resolveResult({
      success: false,
      error: `Timed out after ${TIMEOUT_MS}ms waiting for explicit AJAX/page-resource probe success`,
      targetUrl,
      assetUrl,
      attempts: state.browserAttempts,
      completedProbes: state.completedProbes,
      completedCandidateEvents: state.completedCandidateEvents,
      completedRedditDiagnosticEvents: state.completedRedditDiagnosticEvents,
      pageResourceCandidateEvents: state.pageResourceCandidateEvents,
      pageObserverInstalled: state.pageObserverInstalled,
      lastAttemptAt: state.lastAttemptAt,
    });
  }, TIMEOUT_MS);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
    const expectedHosts = AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost);
    let postSuccessObservation = null;
    if (result?.success && POST_SUCCESS_OBSERVATION_MS > 0) {
      const observationStartedAt = Date.now();
      const remoteRules = await waitForRemoteRuleObservation(
        expectedHosts,
        POST_SUCCESS_OBSERVATION_MS
      );
      const remaining = Math.max(
        0,
        POST_SUCCESS_OBSERVATION_MS - (Date.now() - observationStartedAt)
      );
      const localWhitelist = await waitForLocalWhitelistObservation(expectedHosts, remaining);
      postSuccessObservation = {
        remoteRules,
        localWhitelist,
      };
    }
    const postAttemptDiagnostics = await collectWindowsAutoAllowDiagnostics(
      result?.success ? 'post-success' : 'post-failure'
    );
    const redditPageEvidence = result?.redditDiagnostics ?? {
      completedRedditDiagnosticEvents:
        result?.completedRedditDiagnosticEvents ?? state.completedRedditDiagnosticEvents,
      pageResourceCandidateEvents:
        result?.pageResourceCandidateEvents ?? state.pageResourceCandidateEvents,
    };
    const redditNavigation =
      result?.success && seleniumDriver !== null
        ? await collectRedditRealNavigationDiagnostics({
            driver: seleniumDriver,
            mode: REDDIT_NAVIGATION_MODE,
            pageEvidence: redditPageEvidence,
          })
        : buildRedditNavigationSkippedEvidence(REDDIT_NAVIGATION_MODE, redditPageEvidence);
    const redditDiagnostics = await collectRedditDiagnostics(
      result?.success ? 'post-success' : 'post-failure',
      redditPageEvidence,
      redditNavigation
    );
    const postFailureObservation =
      !result?.success && POST_FAILURE_OBSERVATION_MS > 0
        ? {
            localWhitelist: await waitForLocalWhitelistObservation(
              expectedHosts,
              POST_FAILURE_OBSERVATION_MS
            ),
            diagnostics: await collectWindowsAutoAllowDiagnostics('post-failure-observation'),
          }
        : null;
    const probeEvidence = [];
    for (const probe of WINDOWS_AUTO_ALLOW_ALL_PROBES) {
      probeEvidence.push({
        id: probe.id,
        kind: probe.kind,
        host: probe.host,
        url: buildProbeUrl(probe),
        hits: state.probeHits[probe.id] ?? 0,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        whitelistContainsExpectedHost: await readWhitelistContainsHost(
          probe.expectedWhitelistHost
        ).catch(() => false),
      });
    }
    const summary = buildWindowsAutoAllowCanarySummary({
      result: { ...result, targetUrl, assetUrl },
      probeEvidence,
      originHits: state.originHits,
      attempts: result?.attempts ?? state.browserAttempts,
      completedProbes: result?.completedProbes ?? state.completedProbes,
      completedCandidateEvents: result?.completedCandidateEvents ?? state.completedCandidateEvents,
      completedRedditDiagnosticEvents:
        result?.completedRedditDiagnosticEvents ?? state.completedRedditDiagnosticEvents,
      pageResourceCandidateEvents:
        result?.pageResourceCandidateEvents ?? state.pageResourceCandidateEvents,
      redditDiagnostics,
      pageObserverInstalled: result?.pageObserverInstalled ?? state.pageObserverInstalled,
      lastAttemptAt: result?.lastAttemptAt ?? state.lastAttemptAt,
      whitelistPath: WHITELIST_PATH,
      firefoxExtensionWarmup,
      firefoxOutput: firefoxOutput.slice(-4000),
      diagnostics: {
        preflight: preflightDiagnostics,
        ...(postSuccessObservation ? { postSuccessObservation } : {}),
        postAttempt: postAttemptDiagnostics,
        ...(postFailureObservation ? { postFailureObservation } : {}),
      },
    });

    await emitAjaxAutoAllowCanaryRuntimeSummary({
      summary,
      artifactPath: ARTIFACT_PATH,
      summaryPrefix: 'WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY',
      resultOutputKey: 'windows_ajax_auto_allow_result',
      progress,
    });

    assertWindowsAutoAllowCanarySuccess(summary);
  } finally {
    if (firefox !== null) {
      firefox.kill('SIGTERM');
    }
    if (seleniumDriver !== null) {
      await seleniumDriver.quit().catch(() => {});
    }
    await restoreFirefoxEnterprisePolicy(managedPolicySuspension).catch(() => {});
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runWindowsAjaxAutoAllowCanaryRuntime(
  config = createWindowsAjaxAutoAllowRuntimeConfig(),
  adapters = null
) {
  if (adapters) {
    return runInjectedRuntime(config, adapters);
  }

  return main();
}

export { main as runWindowsAjaxAutoAllowCanaryCli };
