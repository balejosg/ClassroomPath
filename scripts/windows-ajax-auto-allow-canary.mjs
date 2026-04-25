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
const PORT = Number.parseInt(process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_PORT ?? '18088', 10);
const TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS ?? '90000',
  10
);
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

function buildPage(targetUrl) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Windows AJAX Auto-Allow Canary</title></head>
<body>
<pre id="status">starting</pre>
<script>
const statusEl = document.getElementById('status');
const targetUrl = ${JSON.stringify(targetUrl)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function report(payload) {
  await fetch('/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

(async () => {
  const attempts = [];
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      statusEl.textContent = 'fetch attempt ' + attempt;
      const response = await fetch(targetUrl, { cache: 'no-store', mode: 'cors' });
      attempts.push({ attempt, ok: response.ok, status: response.status });
      if (response.ok) {
        await report({ success: true, attempts, targetUrl });
        statusEl.textContent = 'success';
        return;
      }
    } catch (error) {
      attempts.push({ attempt, error: String(error && error.message ? error.message : error) });
    }
    await sleep(2500);
  }

  await report({ success: false, attempts, targetUrl });
  statusEl.textContent = 'failed';
})();
</script>
</body>
</html>`;
}

async function readWhitelistContainsTarget() {
  const contents = await readFile(WHITELIST_PATH, 'utf8');
  return contents.toLowerCase().includes(TARGET_HOST);
}

async function main() {
  const firefoxPath = findFirefox();
  const targetUrl = `http://${TARGET_HOST}:${PORT}/data.json`;
  const originUrl = `http://${ORIGIN_HOST}:${PORT}/`;
  let targetHits = 0;
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

    if (host === TARGET_HOST && req.url === '/data.json') {
      targetHits += 1;
      res.writeHead(200, {
        'Access-Control-Allow-Origin': `http://${ORIGIN_HOST}:${PORT}`,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ ok: true, target: TARGET_HOST, targetHits }));
      return;
    }

    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(buildPage(targetUrl));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });

  const profileDir = await mkdtemp(join(tmpdir(), 'windows-ajax-auto-allow-firefox-'));
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

  const timeout = setTimeout(() => {
    resolveResult({
      success: false,
      error: `Timed out after ${TIMEOUT_MS}ms waiting for AJAX auto-allow success`,
      targetUrl,
    });
  }, TIMEOUT_MS);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
    const whitelistContainsTarget = await readWhitelistContainsTarget().catch(() => false);
    const summary = {
      ...result,
      originHost: ORIGIN_HOST,
      targetHost: TARGET_HOST,
      targetHits,
      whitelistPath: WHITELIST_PATH,
      whitelistContainsTarget,
      firefoxOutput: firefoxOutput.slice(-4000),
    };

    await writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeGithubOutput('windows_ajax_auto_allow_result', summary.success ? 'success' : 'failure');

    if (!summary.success) {
      throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
    }

    if (!summary.whitelistContainsTarget) {
      throw new Error('Auto-allow AJAX target was not written to whitelist');
    }
  } finally {
    firefox.kill('SIGTERM');
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
