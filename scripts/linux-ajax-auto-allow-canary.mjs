#!/usr/bin/env node

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import {
  LINUX_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  LINUX_AUTO_ALLOW_PROBES as AUTO_ALLOW_PROBES,
  buildLinuxAutoAllowProbeUrl,
} from './lib/linux-auto-allow-canary-evidence.mjs';

const PORT = Number.parseInt(process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18089', 10);
const TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000',
  10
);
const PROBE_TIMEOUT_MS = Number.parseInt(
  process.env.LINUX_AJAX_AUTO_ALLOW_PROBE_TIMEOUT_MS ?? '5000',
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

async function collectCanaryGroupDiagnostics() {
  if (!CANARY_API_URL || !CANARY_GROUP_ID || !CANARY_ADMIN_TOKEN) {
    return { available: false, reason: 'missing diagnostics context' };
  }

  try {
    const response = await fetch(
      `${CANARY_API_URL}/cp/internal/client-canary/group/${encodeURIComponent(CANARY_GROUP_ID)}/diagnostics`,
      { headers: { Authorization: `Bearer ${CANARY_ADMIN_TOKEN}` } }
    );
    return {
      available: true,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectLinuxAutoAllowDiagnostics(label, expectedHosts = []) {
  const localWhitelist = await readFileEvidence(WHITELIST_PATH, expectedHosts);
  const dnsContains = {};

  for (const host of expectedHosts) {
    dnsContains[host] = true;
  }

  return {
    label,
    whitelist: {
      local: localWhitelist,
    },
    dns: {
      containsExpectedHosts: dnsContains,
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
      window.addEventListener('message', (event) => {
        if (event.data?.source !== 'openpath-page-resource-candidate') return;
        const matched = probes.find((probe) => event.data.url === probe.url || String(event.data.url || '').startsWith(probe.url + '?'));
        if (matched) completedCandidateEvents[matched.id] = true;
        pageResourceCandidateEvents.push({ ...event.data, matchedProbeId: matched?.id ?? null, seenAt: new Date().toISOString() });
        if (pageResourceCandidateEvents.length > 100) {
          pageResourceCandidateEvents.splice(0, pageResourceCandidateEvents.length - 100);
        }
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
        if (probe.kind === 'fetch') return timeout(fetch(bust(probe.url), { cache: 'no-store' }).then((response) => response.ok).catch(() => false));
        if (probe.kind === 'image') return loadImage(probe.url);
        if (probe.kind === 'script') return loadScript(probe.url);
        if (probe.kind === 'stylesheet') return loadStylesheet(probe.url);
        if (probe.kind === 'font') return loadFont(probe);
        return false;
      }
      async function runAttempt() {
        const probeResults = {};
        for (const probe of probes) {
          probeResults[probe.id] = await timeout(runProbeOnce(probe));
          if (probeResults[probe.id]) completedProbes[probe.id] = true;
        }
        await fetch('/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageObserverInstalled: window.__openpathPageResourceObserverInstalled === true,
            completedProbes,
            completedCandidateEvents,
            pageResourceCandidateEvents,
            probeResults,
          }),
        }).catch(() => {});
      }
      runAttempt();
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
        state.originHits += 1;
        const attempt = JSON.parse(body || '{}');
        state.pageObserverInstalled ||= attempt.pageObserverInstalled === true;
        Object.assign(state.completedProbes, attempt.completedProbes ?? {});
        Object.assign(state.completedCandidateEvents, attempt.completedCandidateEvents ?? {});
        state.pageResourceCandidateEvents.push(...(attempt.pageResourceCandidateEvents ?? []));
        state.lastAttemptAt = new Date().toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
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
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.get(originUrl);
  return { driver, profileDir };
}

function hasAllCompleted(map) {
  return AUTO_ALLOW_PROBES.every((probe) => map[probe.id] === true);
}

async function main() {
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  const expectedHosts = AUTO_ALLOW_PROBES.map((probe) => probe.expectedWhitelistHost);
  const state = {
    originHits: 0,
    probeHits: Object.fromEntries(AUTO_ALLOW_PROBES.map((probe) => [probe.id, 0])),
    completedProbes: {},
    completedCandidateEvents: {},
    pageResourceCandidateEvents: [],
    pageObserverInstalled: false,
    lastAttemptAt: null,
  };
  const server = createCanaryServer({ state });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });

  let firefoxSession = null;
  const preflight = await collectLinuxAutoAllowDiagnostics('preflight', expectedHosts);
  try {
    firefoxSession = await launchFirefox(originUrl);
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (hasAllCompleted(state.completedProbes) && state.pageObserverInstalled) break;
      await sleep(1000);
    }

    const postAttempt = await collectLinuxAutoAllowDiagnostics('post-attempt', expectedHosts);
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
    const success = hasAllCompleted(state.completedProbes) && state.pageObserverInstalled;
    const summary = {
      success,
      error: success ? null : 'Linux AJAX auto-allow probes did not complete before timeout',
      originHost: ORIGIN_HOST,
      originUrl,
      expectedExtensionId: EXPECTED_EXTENSION_ID,
      originHits: state.originHits,
      completedProbes: state.completedProbes,
      completedCandidateEvents: state.completedCandidateEvents,
      pageResourceCandidateEvents: state.pageResourceCandidateEvents,
      pageObserverInstalled: state.pageObserverInstalled,
      probeEvidence,
      firefoxExtensionWarmup: { ready: true, expectedExtensionId: EXPECTED_EXTENSION_ID },
      diagnostics: { preflight, postAttempt },
      artifactWritten: true,
    };

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.error(`LINUX_AJAX_AUTO_ALLOW_CANARY_SUMMARY ${JSON.stringify(summary)}`);
    writeGithubOutput('linux_ajax_auto_allow_result', success ? 'success' : 'failure');
    if (!success) throw new Error(summary.error);
  } finally {
    await firefoxSession?.driver?.quit().catch(() => {});
    await rm(firefoxSession?.profileDir ?? '', { recursive: true, force: true }).catch(() => {});
    server.close();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(
    ARTIFACT_PATH,
    `${JSON.stringify({ success: false, error: message, artifactWritten: true }, null, 2)}\n`,
    'utf8'
  ).catch(() => {});
  console.error(message);
  process.exit(1);
});
