#!/usr/bin/env node

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

const ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
const TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
const ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
const SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
const STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';
const AUTO_ALLOW_PROBES = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: TARGET_HOST,
    path: '/data.json',
    expectedWhitelistHost: TARGET_HOST,
    failureMessage: 'Auto-allow AJAX target was not written to whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: ASSET_HOST,
    failureMessage: 'Auto-allow image target was not written to whitelist',
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: SCRIPT_HOST,
    failureMessage: 'Auto-allow script target was not written to whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: STYLESHEET_HOST,
    failureMessage: 'Auto-allow stylesheet target was not written to whitelist',
  },
]);
const PORT = Number.parseInt(process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18088', 10);
const TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000',
  10
);
const FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_WARMUP_TIMEOUT_MS ?? '60000',
  10
);
const EXPECTED_EXTENSION_ID = process.env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath';
const WHITELIST_PATH = process.env.OPENPATH_WHITELIST_PATH ?? 'C:\\OpenPath\\data\\whitelist.txt';
const ARTIFACT_PATH =
  process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT ??
  'production-windows-ajax-auto-allow-canary.json';

function findFirefox() {
  const candidates = [
    process.env.FIREFOX_PATH,
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  ].filter(Boolean);

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
  return `http://${probe.host}:${PORT}${probe.path}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function report(payload) {
  await fetch('/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function runProbe(probe) {
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

  return { ok: false, error: 'unsupported probe kind: ' + probe.kind };
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

(async () => {
  const attempts = [];
  const completed = Object.fromEntries(probes.map((probe) => [probe.id, false]));
  for (let attempt = 1; attempt <= 40; attempt += 1) {
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
    if (Object.values(completed).every(Boolean)) {
        await report({ success: true, attempts, probes });
        statusEl.textContent = 'success';
        return;
    }
    await sleep(2500);
  }

  await report({ success: false, attempts, probes });
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

    const matchedProbe = AUTO_ALLOW_PROBES.find(
      (probe) => host === probe.host && String(req.url ?? '').startsWith(probe.path)
    );

    if (host === ORIGIN_HOST) {
      originHits += 1;
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

  const profileDir = await mkdtemp(join(tmpdir(), 'windows-ajax-auto-allow-firefox-'));
  const firefoxExtensionWarmup = await waitForFirefoxExtensionReady({ firefoxPath, profileDir });
  if (!firefoxExtensionWarmup.ready) {
    const summary = {
      success: false,
      error: `Timed out after ${FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS}ms waiting for Firefox extension ${EXPECTED_EXTENSION_ID} to be ready`,
      originHost: ORIGIN_HOST,
      targetHost: TARGET_HOST,
      assetHost: ASSET_HOST,
      scriptHost: SCRIPT_HOST,
      stylesheetHost: STYLESHEET_HOST,
      targetUrl,
      assetUrl,
      firefoxExtensionWarmup,
      whitelistPath: WHITELIST_PATH,
    };

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeGithubOutput('windows_ajax_auto_allow_result', 'failure');
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
  }

  const firefox = spawn(
    firefoxPath,
    ['-headless', '-no-remote', '-profile', profileDir, originUrl],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let firefoxOutput = '';
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
    });
  });

  const timeout = setTimeout(() => {
    resolveResult({
      success: false,
      error: `Timed out after ${TIMEOUT_MS}ms waiting for AJAX auto-allow success`,
      targetUrl,
      assetUrl,
    });
  }, TIMEOUT_MS);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
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
    const whitelistContainsTarget =
      probeEvidence.find((probe) => probe.id === 'ajax-fetch')?.whitelistContainsExpectedHost ??
      false;
    const whitelistContainsAsset =
      probeEvidence.find((probe) => probe.id === 'image-subresource')
        ?.whitelistContainsExpectedHost ?? false;
    const summary = {
      ...result,
      originHost: ORIGIN_HOST,
      targetHost: TARGET_HOST,
      assetHost: ASSET_HOST,
      scriptHost: SCRIPT_HOST,
      stylesheetHost: STYLESHEET_HOST,
      targetUrl,
      assetUrl,
      originHits,
      targetHits: probeHits['ajax-fetch'] ?? 0,
      assetHits: probeHits['image-subresource'] ?? 0,
      probeEvidence,
      whitelistPath: WHITELIST_PATH,
      whitelistContainsTarget,
      whitelistContainsAsset,
      firefoxExtensionWarmup,
      firefoxOutput: firefoxOutput.slice(-4000),
    };

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeGithubOutput('windows_ajax_auto_allow_result', summary.success ? 'success' : 'failure');

    if (!summary.success) {
      throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
    }

    for (const probe of AUTO_ALLOW_PROBES) {
      const evidence = probeEvidence.find((item) => item.id === probe.id);
      if (!evidence?.whitelistContainsExpectedHost) {
        throw new Error(probe.failureMessage);
      }
    }
  } finally {
    firefox.kill('SIGTERM');
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
