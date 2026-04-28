#!/usr/bin/env node

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  WINDOWS_AUTO_ALLOW_ASSET_HOST as ASSET_HOST,
  WINDOWS_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  WINDOWS_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  WINDOWS_AUTO_ALLOW_SCRIPT_HOST as SCRIPT_HOST,
  WINDOWS_AUTO_ALLOW_STYLESHEET_HOST as STYLESHEET_HOST,
  WINDOWS_AUTO_ALLOW_TARGET_HOST as TARGET_HOST,
  assertWindowsAutoAllowCanarySuccess,
  buildWindowsAutoAllowCanarySummary,
  buildWindowsAutoAllowProbeUrl,
  redactSensitiveWindowsCanaryValue,
  redactWindowsCanaryObject,
} from './lib/windows-auto-allow-canary-evidence.mjs';
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
const MAX_ATTEMPT_EVIDENCE = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_MAX_ATTEMPT_EVIDENCE ?? '60',
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

function writeGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
}

function buildProbeUrl(probe) {
  return buildWindowsAutoAllowProbeUrl(probe, PORT);
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

function evidenceContainsAllExpectedHosts(evidence, expectedHosts = []) {
  if (!evidence?.containsExpectedHosts) {
    return false;
  }

  return expectedHosts.every((host) => evidence.containsExpectedHosts[host] === true);
}

async function waitForLocalWhitelistObservation(expectedHosts = [], timeoutMs = 0) {
  const startedAt = Date.now();
  let globalWhitelist = await readFileEvidence(WHITELIST_PATH, expectedHosts);
  let nativeWhitelist = await readFileEvidence(NATIVE_WHITELIST_PATH, expectedHosts);
  const containsAllExpectedHosts = () =>
    evidenceContainsAllExpectedHosts(globalWhitelist, expectedHosts) ||
    evidenceContainsAllExpectedHosts(nativeWhitelist, expectedHosts);

  if (timeoutMs <= 0) {
    return {
      observed: containsAllExpectedHosts(),
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      global: globalWhitelist,
      native: nativeWhitelist,
    };
  }

  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    if (containsAllExpectedHosts()) {
      return {
        observed: true,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        global: globalWhitelist,
        native: nativeWhitelist,
      };
    }

    await sleep(2000);
    globalWhitelist = await readFileEvidence(WHITELIST_PATH, expectedHosts);
    nativeWhitelist = await readFileEvidence(NATIVE_WHITELIST_PATH, expectedHosts);
  }

  return {
    observed: containsAllExpectedHosts(),
    timeoutMs,
    elapsedMs: Date.now() - startedAt,
    global: globalWhitelist,
    native: nativeWhitelist,
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
  const expectedHosts = AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost);
  const [
    globalWhitelist,
    nativeWhitelist,
    nativeState,
    nativeLogTail,
    openPathLogTail,
    updateTask,
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
        sse: sseTask,
      },
      taskName: 'OpenPath-Update',
      task: updateTask,
    },
    nativeProtocol,
    server: {
      canaryGroup,
    },
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
  const extensionEvidence = await readProfileExtensionEvidence(String(activeProfileDir));

  await driver.get(originUrl);

  return {
    driver,
    firefoxExtensionWarmup: {
      ...extensionEvidence,
      ready: true,
      mode: USE_LOCAL_FIREFOX_ADDON ? 'selenium-local-addon' : 'selenium-managed',
      localAddonPath: USE_LOCAL_FIREFOX_ADDON ? LOCAL_ADDON_PATH : null,
      geckodriverPath: GECKODRIVER_PATH || null,
      profileDir: activeProfileDir,
      timeoutMs: FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS,
    },
  };
}

function buildPage(probes) {
  const browserProbes = probes.map((probe) => ({
    id: probe.id,
    kind: probe.kind,
    url: buildProbeUrl(probe),
  }));

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Windows AJAX Auto-Allow Canary</title></head>
<body>
<pre id="status">starting</pre>
<script>
const statusEl = document.getElementById('status');
const probes = ${JSON.stringify(browserProbes)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PROBE_TIMEOUT_MS = 4000;
const CANARY_TIMEOUT_MS = ${TIMEOUT_MS};
const pageResourceCandidateEvents = [];
const completedCandidateEvents = Object.fromEntries(probes.map((probe) => [probe.id, false]));

function isOpenPathPageObserverInstalled() {
  return window.__openpathPageResourceObserverInstalled === true;
}

function normalizeCandidateUrl(url) {
  try {
    const parsed = new URL(String(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '');
  }
}

window.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (data.source !== 'openpath-page-resource-candidate' || typeof data.url !== 'string') {
    return;
  }

  const normalizedCandidateUrl = normalizeCandidateUrl(data.url);
  const matchedProbe = probes.find(
    (probe) => normalizeCandidateUrl(probe.url) === normalizedCandidateUrl
  );
  if (matchedProbe) {
    completedCandidateEvents[matchedProbe.id] = true;
  }

  pageResourceCandidateEvents.push({
    kind: typeof data.kind === 'string' ? data.kind : 'unknown',
    url: data.url,
    matchedProbeId: matchedProbe ? matchedProbe.id : null,
    seenAt: new Date().toISOString()
  });
  if (pageResourceCandidateEvents.length > 100) {
    pageResourceCandidateEvents.splice(0, pageResourceCandidateEvents.length - 100);
  }
});

async function report(payload) {
  await fetch('/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function reportAttempt(attemptResult, completed) {
  try {
    await fetch('/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt: attemptResult,
        completedProbes: completed,
        completedCandidateEvents,
        pageResourceCandidateEvents,
        pageObserverInstalled: isOpenPathPageObserverInstalled()
      })
    });
  } catch {
    // The final /result payload still carries attempts if the page reaches it.
  }
}

async function runProbe(probe) {
  return await withTimeout(runProbeOnce(probe), PROBE_TIMEOUT_MS, probe.id);
}

async function runProbeOnce(probe) {
  if (probe.kind === 'fetch') {
    const response = await fetch(probe.url, { cache: 'no-store', mode: 'cors' });
    return { ok: response.ok, status: response.status };
  }

  if (probe.kind === 'image') {
    return await loadImage(probe.url);
  }

  if (probe.kind === 'script') {
    return await loadScript(probe.url);
  }

  if (probe.kind === 'stylesheet') {
    return await loadStylesheet(probe.url);
  }

  if (probe.kind === 'font') {
    return await loadFont(probe.url, probe.id);
  }

  return { ok: false, error: 'unsupported probe kind: ' + probe.kind };
}

function withTimeout(promise, timeoutMs, probeId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: probeId + ' timed out after ' + timeoutMs + 'ms' });
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          error: String(error && error.message ? error.message : error)
        });
      });
  });
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ ok: true });
    image.onerror = () => resolve({ ok: false, error: 'image load failed' });
    image.src = url + '?attempt=' + Date.now();
  });
}

function loadScript(url) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.onload = () => resolve({ ok: true });
    script.onerror = () => resolve({ ok: false, error: 'script load failed' });
    script.src = url + '?attempt=' + Date.now();
    document.body.appendChild(script);
  });
}

function loadStylesheet(url) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onload = () => resolve({ ok: true });
    link.onerror = () => resolve({ ok: false, error: 'stylesheet load failed' });
    link.href = url + '?attempt=' + Date.now();
    document.head.appendChild(link);
  });
}

async function readProbeHits(probeId) {
  const response = await fetch('/probe-state?probe=' + encodeURIComponent(probeId), {
    cache: 'no-store'
  });
  if (!response.ok) return 0;
  const payload = await response.json();
  return Number(payload && payload.hits ? payload.hits : 0);
}

function loadFont(url, probeId) {
  return new Promise((resolve) => {
    const attemptUrl = url + '?attempt=' + Date.now();
    const family = 'OpenPathAjaxAutoAllowFont' + Date.now();
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.crossOrigin = 'anonymous';
    link.href = attemptUrl;
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent =
      '@font-face { font-family: "' +
      family +
      '"; src: url("' +
      attemptUrl +
      '") format("woff2"); }';
    document.head.appendChild(style);

    const sample = document.createElement('span');
    sample.textContent = 'font probe';
    sample.style.fontFamily = '"' + family + '", sans-serif';
    sample.style.position = 'absolute';
    sample.style.left = '-9999px';
    document.body.appendChild(sample);

    setTimeout(async () => {
      const hits = await readProbeHits(probeId).catch(() => 0);
      resolve(hits > 0 ? { ok: true, hits } : { ok: false, hits, error: 'font load did not reach canary server' });
    }, 1000);
  });
}

(async () => {
  const attempts = [];
  const completed = Object.fromEntries(probes.map((probe) => [probe.id, false]));
  const deadline = Date.now() + CANARY_TIMEOUT_MS;
  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    const attemptResult = { attempt, probes: {} };
    for (const probe of probes) {
      if (completed[probe.id]) {
        attemptResult.probes[probe.id] = { ok: true, skipped: true };
        continue;
      }

      try {
        statusEl.textContent = probe.id + ' attempt ' + attempt;
        const probeResult = await runProbe(probe);
        attemptResult.probes[probe.id] = probeResult;
        completed[probe.id] = probeResult.ok === true;
      } catch (error) {
        attemptResult.probes[probe.id] = {
          error: String(error && error.message ? error.message : error)
        };
      }
    }

    attempts.push(attemptResult);
    await reportAttempt(attemptResult, completed);
    if (Object.values(completed).every(Boolean)) {
        await report({
          success: true,
          attempts,
          probes,
          completedCandidateEvents,
          pageResourceCandidateEvents,
          pageObserverInstalled: isOpenPathPageObserverInstalled()
        });
        statusEl.textContent = 'success';
        return;
    }
    await sleep(2500);
  }

  await report({
    success: false,
    attempts,
    probes,
    completedCandidateEvents,
    pageResourceCandidateEvents,
    pageObserverInstalled: isOpenPathPageObserverInstalled()
  });
  statusEl.textContent = 'failed';
})();
</script>
</body>
</html>`;
}

async function readWhitelistContainsHost(host) {
  const contents = await readFile(WHITELIST_PATH, 'utf8');
  return contents.toLowerCase().includes(String(host).toLowerCase());
}

async function main() {
  const firefoxPath = findFirefox();
  const targetUrl = buildProbeUrl(AUTO_ALLOW_PROBES[0]);
  const assetUrl = buildProbeUrl(AUTO_ALLOW_PROBES[1]);
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  const probeHits = Object.fromEntries(AUTO_ALLOW_PROBES.map((probe) => [probe.id, 0]));
  let originHits = 0;
  let resultPayload = null;
  const browserAttempts = [];
  let completedProbes = Object.fromEntries(AUTO_ALLOW_PROBES.map((probe) => [probe.id, false]));
  let completedCandidateEvents = Object.fromEntries(
    AUTO_ALLOW_PROBES.map((probe) => [probe.id, false])
  );
  let pageResourceCandidateEvents = [];
  let pageObserverInstalled = false;
  let lastAttemptAt = null;
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const server = createServer((req, res) => {
    const host =
      String(req.headers.host ?? '')
        .split(':', 1)[0]
        ?.toLowerCase() ?? '';

    if (req.method === 'POST' && req.url === '/result') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resultPayload = JSON.parse(body);
        } catch {
          resultPayload = { success: false, error: 'invalid result payload', raw: body };
        }
        res.writeHead(204);
        res.end();
        resolveResult(resultPayload);
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/attempt') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = redactWindowsCanaryObject(JSON.parse(body));
          browserAttempts.push(payload.attempt ?? payload);
          if (payload.completedProbes && typeof payload.completedProbes === 'object') {
            completedProbes = payload.completedProbes;
          }
          if (
            payload.completedCandidateEvents &&
            typeof payload.completedCandidateEvents === 'object'
          ) {
            completedCandidateEvents = payload.completedCandidateEvents;
          }
          if (Array.isArray(payload.pageResourceCandidateEvents)) {
            pageResourceCandidateEvents = payload.pageResourceCandidateEvents.slice(-100);
          }
          if (typeof payload.pageObserverInstalled === 'boolean') {
            pageObserverInstalled = payload.pageObserverInstalled;
          }
        } catch {
          browserAttempts.push({
            error: 'invalid attempt payload',
            raw: redactSensitiveWindowsCanaryValue(body.slice(-1000)),
          });
        }
        if (browserAttempts.length > MAX_ATTEMPT_EVIDENCE) {
          browserAttempts.splice(0, browserAttempts.length - MAX_ATTEMPT_EVIDENCE);
        }
        lastAttemptAt = new Date().toISOString();
        res.writeHead(204);
        res.end();
      });
      return;
    }

    const matchedProbe = AUTO_ALLOW_PROBES.find(
      (probe) => host === probe.host && String(req.url ?? '').startsWith(probe.path)
    );

    if (host === ORIGIN_HOST) {
      originHits += 1;
    }

    if (
      host === ORIGIN_HOST &&
      req.method === 'GET' &&
      String(req.url ?? '').startsWith('/probe-state')
    ) {
      const stateUrl = new URL(String(req.url ?? '/probe-state'), `http://${ORIGIN_HOST}:${PORT}`);
      const probeId = stateUrl.searchParams.get('probe') ?? '';
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ hits: probeHits[probeId] ?? 0, probe: probeId }));
      return;
    }

    if (matchedProbe?.id === 'ajax-fetch') {
      probeHits[matchedProbe.id] += 1;
      res.writeHead(200, {
        'Access-Control-Allow-Origin': `http://${ORIGIN_HOST}:${PORT}`,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({ ok: true, target: TARGET_HOST, targetHits: probeHits['ajax-fetch'] })
      );
      return;
    }

    if (matchedProbe?.id === 'image-subresource') {
      probeHits[matchedProbe.id] += 1;
      const transparentPixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
      });
      res.end(transparentPixel);
      return;
    }

    if (matchedProbe?.id === 'script-subresource') {
      probeHits[matchedProbe.id] += 1;
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/javascript; charset=utf-8',
      });
      res.end('window.__openpathAjaxAutoAllowScriptProbe = true;');
      return;
    }

    if (matchedProbe?.id === 'stylesheet-subresource') {
      probeHits[matchedProbe.id] += 1;
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/css; charset=utf-8',
      });
      res.end('body { --openpath-ajax-auto-allow-style-probe: loaded; }');
      return;
    }

    if (matchedProbe?.id === 'font-subresource') {
      probeHits[matchedProbe.id] += 1;
      res.writeHead(200, {
        'Access-Control-Allow-Origin': `http://${ORIGIN_HOST}:${PORT}`,
        'Cache-Control': 'no-store',
        'Content-Type': 'font/woff2',
      });
      res.end(Buffer.from('d09GMgABAAAAAA==', 'base64'));
      return;
    }

    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(buildPage(AUTO_ALLOW_PROBES));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });

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
      originHits,
      attempts: browserAttempts,
      completedProbes,
      completedCandidateEvents,
      pageResourceCandidateEvents,
      lastAttemptAt,
      whitelistPath: WHITELIST_PATH,
      firefoxExtensionWarmup,
      firefoxOutput,
      diagnostics: {
        preflight: preflightDiagnostics,
        postFailure: await collectWindowsAutoAllowDiagnostics('post-firefox-warmup-failure'),
      },
    });

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.error(`WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY ${JSON.stringify(summary)}`);
    writeGithubOutput('windows_ajax_auto_allow_result', 'failure');
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await restoreFirefoxEnterprisePolicy(managedPolicySuspension).catch(() => {});
    throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
  }

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
        attempts: browserAttempts,
        completedProbes,
        completedCandidateEvents,
        pageResourceCandidateEvents,
        pageObserverInstalled,
        lastAttemptAt,
      });
    });
  }

  const timeout = setTimeout(() => {
    resolveResult({
      success: false,
      error: `Timed out after ${TIMEOUT_MS}ms waiting for AJAX auto-allow success`,
      targetUrl,
      assetUrl,
      attempts: browserAttempts,
      completedProbes,
      completedCandidateEvents,
      pageResourceCandidateEvents,
      pageObserverInstalled,
      lastAttemptAt,
    });
  }, TIMEOUT_MS);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
    const postAttemptDiagnostics = await collectWindowsAutoAllowDiagnostics(
      result?.success ? 'post-success' : 'post-failure'
    );
    const expectedHosts = AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost);
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
    for (const probe of AUTO_ALLOW_PROBES) {
      probeEvidence.push({
        id: probe.id,
        kind: probe.kind,
        host: probe.host,
        url: buildProbeUrl(probe),
        hits: probeHits[probe.id] ?? 0,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        whitelistContainsExpectedHost: await readWhitelistContainsHost(
          probe.expectedWhitelistHost
        ).catch(() => false),
      });
    }
    const summary = buildWindowsAutoAllowCanarySummary({
      result: { ...result, targetUrl, assetUrl },
      probeEvidence,
      originHits,
      attempts: result?.attempts ?? browserAttempts,
      completedProbes: result?.completedProbes ?? completedProbes,
      completedCandidateEvents: result?.completedCandidateEvents ?? completedCandidateEvents,
      pageResourceCandidateEvents:
        result?.pageResourceCandidateEvents ?? pageResourceCandidateEvents,
      pageObserverInstalled: result?.pageObserverInstalled ?? pageObserverInstalled,
      lastAttemptAt: result?.lastAttemptAt ?? lastAttemptAt,
      whitelistPath: WHITELIST_PATH,
      firefoxExtensionWarmup,
      firefoxOutput: firefoxOutput.slice(-4000),
      diagnostics: {
        preflight: preflightDiagnostics,
        postAttempt: postAttemptDiagnostics,
        ...(postFailureObservation ? { postFailureObservation } : {}),
      },
    });

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    const summaryLine = `WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY ${JSON.stringify(summary)}`;
    if (summary.success) {
      console.log(summaryLine);
    } else {
      console.error(summaryLine);
    }
    writeGithubOutput('windows_ajax_auto_allow_result', summary.success ? 'success' : 'failure');

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

await main();
