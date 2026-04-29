#!/usr/bin/env node

import { createServer } from 'node:http';
import dns from 'node:dns/promises';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  LINUX_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  LINUX_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  buildLinuxAutoAllowProbeUrl,
  withLinuxAutoAllowDiagnostics,
} from './lib/linux-auto-allow-canary-evidence.mjs';

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
  return buildLinuxAutoAllowProbeUrl(probe, PORT);
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
  if (!CANARY_API_URL || !CANARY_GROUP_ID || !CANARY_ADMIN_TOKEN) {
    return { available: false, reason: 'missing diagnostics context' };
  }

  const url = `${CANARY_API_URL}/cp/internal/client-canary/group/${encodeURIComponent(CANARY_GROUP_ID)}/diagnostics`;
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${CANARY_ADMIN_TOKEN}` },
      });
      const body = await response.json().catch(() => null);
      lastResult = {
        available: true,
        status: response.status,
        body,
        attempt,
      };
      if (response.status !== 429 || attempt === 3) {
        return lastResult;
      }

      const retryAfterMs = Number(body?.error?.data?.retryAfterMs ?? 0);
      await sleep(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 5000);
    } catch (error) {
      lastResult = {
        available: false,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      };
      if (attempt === 3) {
        return lastResult;
      }
      await sleep(1000 * attempt);
    }
  }

  return lastResult ?? { available: false, reason: 'diagnostics request did not run' };
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

function buildPage(probes) {
  const probePayload = JSON.stringify(
    probes.map((probe) => ({ ...probe, url: buildProbeUrl(probe) }))
  );
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Linux AJAX Auto-Allow Canary</title></head>
  <body>
    <script>
      const probes = ${probePayload};
      const completedProbes = {};
      const completedCandidateEvents = {};
      const pageResourceCandidateEvents = [];
      const canaryState = window.__openpathLinuxAjaxCanaryState = {
        startedAt: new Date().toISOString(),
        lastPhase: 'init',
        attempts: [],
        completedCandidateEvents,
        pageResourceCandidateEvents,
        errors: [],
      };
      window.addEventListener('error', (event) => {
        canaryState.errors.push({
          type: 'error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });
      window.addEventListener('unhandledrejection', (event) => {
        canaryState.errors.push({
          type: 'unhandledrejection',
          message: String(event.reason?.message || event.reason || 'unknown'),
        });
      });
      function recordPageResourceCandidate(candidate) {
        if (candidate?.source !== 'openpath-page-resource-candidate') return;
        const matched = probes.find((probe) => candidate.url === probe.url || String(candidate.url || '').startsWith(probe.url + '?'));
        if (matched) completedCandidateEvents[matched.id] = true;
        pageResourceCandidateEvents.push({ ...candidate, matchedProbeId: matched?.id ?? null, seenAt: new Date().toISOString() });
        if (pageResourceCandidateEvents.length > 100) {
          pageResourceCandidateEvents.splice(0, pageResourceCandidateEvents.length - 100);
        }
      }
      window.addEventListener('message', (event) => {
        recordPageResourceCandidate(event.data);
      });
      window.addEventListener('openpath-page-resource-candidate', (event) => {
        recordPageResourceCandidate(event.detail);
      });

      const timeout = (promise) => Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(false), ${PROBE_TIMEOUT_MS}))
      ]);
      const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'cache=' + Date.now();
      const loadImage = (url) => timeout(new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = bust(url);
      }));
      const loadScript = (url) => timeout(new Promise((resolve) => {
        const script = document.createElement('script');
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        script.src = bust(url);
        document.body.appendChild(script);
      }));
      const loadStylesheet = (url) => timeout(new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.onload = () => resolve(true);
        link.onerror = () => resolve(false);
        link.href = bust(url);
        document.head.appendChild(link);
      }));
      async function readProbeHits(probeId) {
        canaryState.lastPhase = 'read-probe-hits:' + probeId;
        const response = await fetch('/probe-state?probe=' + encodeURIComponent(probeId), {
          cache: 'no-store',
        });
        if (!response.ok) return 0;
        const payload = await response.json();
        return Number(payload?.hits ?? 0);
      }
      const loadFont = (probe) => timeout(new Promise((resolve) => {
        const url = probe.url;
        const style = document.createElement('style');
        const family = 'OpenPathLinuxCanary' + Date.now();
        style.textContent = '@font-face { font-family: "' + family + '"; src: url("' + bust(url) + '") format("woff2"); } body { fontFamily: "' + family + '"; }';
        document.head.appendChild(style);
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'font';
        link.type = 'font/woff2';
        link.crossOrigin = 'anonymous';
        link.href = bust(url);
        document.head.appendChild(link);
        setTimeout(async () => {
          const hits = await readProbeHits(probe.id).catch(() => 0);
          resolve(hits > 0);
        }, 1000);
      }));
      async function runProbeOnce(probe) {
        canaryState.lastPhase = 'probe:' + probe.id;
        if (probe.kind === 'fetch') return timeout(fetch(bust(probe.url), { cache: 'no-store' }).then((response) => response.ok).catch(() => false));
        if (probe.kind === 'image') return loadImage(probe.url);
        if (probe.kind === 'script') return loadScript(probe.url);
        if (probe.kind === 'stylesheet') return loadStylesheet(probe.url);
        if (probe.kind === 'font') return loadFont(probe);
        return false;
      }
      async function runAttempt() {
        const attempt = {
          startedAt: new Date().toISOString(),
          probeResults: {},
        };
        canaryState.attempts.push(attempt);
        canaryState.lastPhase = 'attempt-start';
        const probeResults = {};
        try {
          const results = await Promise.all(
            probes.map(async (probe) => ({
              id: probe.id,
              ok: await timeout(runProbeOnce(probe)),
            }))
          );
          for (const result of results) {
            probeResults[result.id] = result.ok;
            attempt.probeResults[result.id] = result.ok;
            if (result.ok) completedProbes[result.id] = true;
          }
          canaryState.lastPhase = 'post-attempt';
          attempt.completedAt = new Date().toISOString();
        } catch (error) {
          canaryState.errors.push({
            type: 'attempt-error',
            message: String(error?.message || error || 'unknown'),
          });
          attempt.error = String(error?.message || error || 'unknown');
        }
        await fetch('/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageObserverInstalled: window.__openpathPageResourceObserverInstalled === true,
            pageObserverState: window.__openpathPageResourceObserverState ?? null,
            completedProbes,
            completedCandidateEvents,
            pageResourceCandidateEvents,
            probeResults,
          }),
        }).catch((error) => {
          canaryState.errors.push({
            type: 'attempt-post-error',
            message: String(error?.message || error || 'unknown'),
          });
        });
        canaryState.lastPhase = 'attempt-finished';
      }
      runAttempt().catch((error) => {
        canaryState.errors.push({
          type: 'run-attempt-error',
          message: String(error?.message || error || 'unknown'),
        });
      });
      setInterval(runAttempt, 3000);
    </script>
  </body>
</html>`;
}

function createCanaryServer({ state }) {
  return createServer((req, res) => {
    const host = String(req.headers.host ?? '')
      .split(':')[0]
      ?.toLowerCase();
    const url = new URL(req.url ?? '/', `http://${host}:${PORT}`);
    const matchedProbe = AUTO_ALLOW_PROBES.find(
      (probe) => host === probe.host && url.pathname === probe.path
    );

    if (host === ORIGIN_HOST && req.method === 'GET' && url.pathname === '/probe-state') {
      const probeId = url.searchParams.get('probe') ?? '';
      res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hits: Number(state.probeHits[probeId] ?? 0) }));
      return;
    }

    if (host === ORIGIN_HOST && req.method === 'POST' && url.pathname === '/attempt') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        state.attemptHits += 1;
        const attempt = JSON.parse(body || '{}');
        state.pageObserverInstalled ||= attempt.pageObserverInstalled === true;
        if (attempt.pageObserverState) state.pageObserverState = attempt.pageObserverState;
        Object.assign(state.completedProbes, attempt.completedProbes ?? {});
        Object.assign(state.completedCandidateEvents, attempt.completedCandidateEvents ?? {});
        state.pageResourceCandidateEvents.push(...(attempt.pageResourceCandidateEvents ?? []));
        state.lastAttemptAt = new Date().toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (host === ORIGIN_HOST && req.method === 'GET' && url.pathname === '/') {
      state.originPageHits += 1;
    }

    if (matchedProbe) {
      state.probeHits[matchedProbe.id] += 1;
      const headers = { 'Cache-Control': 'no-store' };
      if (matchedProbe.kind === 'fetch') {
        res.writeHead(200, {
          ...headers,
          'Access-Control-Allow-Origin': `http://${ORIGIN_HOST}:${PORT}`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (matchedProbe.kind === 'image') {
        res.writeHead(200, { ...headers, 'Content-Type': 'image/png' });
        res.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
            'base64'
          )
        );
        return;
      }
      if (matchedProbe.kind === 'script') {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end('window.__openpathLinuxAjaxAutoAllowScriptProbe = true;');
        return;
      }
      if (matchedProbe.kind === 'stylesheet') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/css; charset=utf-8' });
        res.end('body { --openpath-linux-ajax-auto-allow-style-probe: loaded; }');
        return;
      }
      if (matchedProbe.kind === 'font') {
        res.writeHead(200, {
          ...headers,
          'Access-Control-Allow-Origin': `http://${ORIGIN_HOST}:${PORT}`,
          'Content-Type': 'font/woff2',
        });
        res.end(Buffer.from('d09GMgABAAAAAA==', 'base64'));
        return;
      }
    }

    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildPage(AUTO_ALLOW_PROBES));
  });
}

async function launchFirefox(originUrl) {
  const { Builder } = await import('selenium-webdriver');
  const firefox = await import('selenium-webdriver/firefox.js');
  const profileDir = await mkdtemp(join(tmpdir(), 'linux-ajax-auto-allow-firefox-'));
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setPreference('network.dns.disablePrefetch', true);
  options.setPreference('network.trr.mode', 5);
  options.setPreference('network.trr.uri', '');
  options.setPreference('network.dnsCacheExpiration', 0);
  options.setPreference('network.dnsCacheExpirationGracePeriod', 0);
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ pageLoad: PAGE_LOAD_TIMEOUT_MS, script: 10000 });
  try {
    await driver.get(originUrl);
  } catch (error) {
    console.error(
      `Linux AJAX canary page load did not complete within ${PAGE_LOAD_TIMEOUT_MS}ms: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return { driver, profileDir };
}

async function waitForPageObserver(driver, originUrl) {
  const deadline = Date.now() + PAGE_OBSERVER_WAIT_MS;
  let lastDiagnostics = await collectBrowserNavigationDiagnostics(driver);
  let lastReloadAt = 0;

  while (Date.now() < deadline) {
    if (lastDiagnostics.openpathObserverInstalled === true) {
      return lastDiagnostics;
    }

    const now = Date.now();
    if (now - lastReloadAt >= 5000) {
      lastReloadAt = now;
      await driver.get(originUrl).catch((error) => {
        console.error(
          `Linux AJAX canary observer reload did not complete: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    } else {
      await sleep(1000);
    }
    lastDiagnostics = await collectBrowserNavigationDiagnostics(driver);
  }

  return lastDiagnostics;
}

function hasAllCompleted(map) {
  return AUTO_ALLOW_PROBES.every((probe) => map[probe.id] === true);
}

async function main() {
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  const expectedHosts = [
    ORIGIN_HOST,
    ...AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost),
  ];
  const state = {
    originPageHits: 0,
    attemptHits: 0,
    probeHits: Object.fromEntries(AUTO_ALLOW_PROBES.map((probe) => [probe.id, 0])),
    completedProbes: {},
    completedCandidateEvents: {},
    pageResourceCandidateEvents: [],
    pageObserverInstalled: false,
    pageObserverState: null,
    lastAttemptAt: null,
  };
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
      if (hasAllCompleted(state.completedProbes) && state.pageObserverInstalled) break;
      await sleep(1000);
    }

    const browserNavigationAfterAttempts = await collectBrowserNavigationDiagnostics(
      firefoxSession.driver
    );
    const postAttempt = await collectLinuxAutoAllowDiagnostics('post-attempt', expectedHosts);
    const completedProbesFromTraffic = Object.fromEntries(
      AUTO_ALLOW_PROBES.map((probe) => [probe.id, Number(state.probeHits[probe.id] ?? 0) > 0])
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
    const success = hasAllCompleted(completedProbesFromTraffic) && pageObserverInstalled;
    const failureDebug = success ? null : await collectLinuxFailureDebugSnapshot();
    const summary = withLinuxAutoAllowDiagnostics({
      success,
      error: success ? null : 'Linux AJAX auto-allow probes did not complete before timeout',
      originHost: ORIGIN_HOST,
      originUrl,
      expectedExtensionId: EXPECTED_EXTENSION_ID,
      originHits: state.originPageHits,
      originPageHits: state.originPageHits,
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
      firefoxExtensionWarmup: { ready: true, expectedExtensionId: EXPECTED_EXTENSION_ID },
      browserNavigation: {
        beforeAttempts: browserNavigationBeforeAttempts,
        afterAttempts: browserNavigationAfterAttempts,
      },
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
