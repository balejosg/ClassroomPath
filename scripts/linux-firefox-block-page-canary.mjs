#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants, accessSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { Builder, By, until } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';

const DEFAULT_EXTENSION_ID = 'monitor-bloqueos@openpath';
const DEFAULT_BLOCKED_URL = 'https://www.mozilla.org/';
const DEFAULT_TIMEOUT_MS = 30000;
const NATIVE_HOST_NAME = 'whitelist_native_host';
const NATIVE_HOST_MANIFEST_CANDIDATES = [
  '/usr/lib/mozilla/native-messaging-hosts/whitelist_native_host.json',
  '/usr/lib64/mozilla/native-messaging-hosts/whitelist_native_host.json',
  join(process.env.HOME ?? '', '.mozilla/native-messaging-hosts/whitelist_native_host.json'),
].filter((candidate) => candidate.length > 0);

function valueOrFallback(value, fallback) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function shellOutput(command) {
  try {
    return execFileSync('bash', ['-lc', command], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function resolveFirefoxBinary() {
  const explicit = valueOrFallback(process.env.FIREFOX_BINARY, '');
  if (explicit) {
    return explicit;
  }

  const discovered = shellOutput('command -v firefox || command -v firefox-esr || true');
  assert.ok(discovered, 'Firefox binary was not found after Linux enrollment');
  return discovered.split('\n')[0];
}

function readFirefoxPolicy(extensionId) {
  const candidatePaths = [
    '/etc/firefox/policies/policies.json',
    '/usr/lib/firefox/distribution/policies.json',
    '/usr/lib/firefox-esr/distribution/policies.json',
  ];

  for (const policyPath of candidatePaths) {
    if (!existsSync(policyPath)) {
      continue;
    }

    const policyText = readFileSync(policyPath, 'utf8');
    if (policyText.includes(extensionId)) {
      return { path: policyPath, text: policyText };
    }
  }

  return { path: null, text: '' };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function summarizeFirefoxPolicy(policy, extensionId) {
  if (!policy.path) {
    return { path: null, managedExtension: null };
  }

  const parsed = safeJsonParse(policy.text);
  const policyRoot = parsed?.policies ?? {};
  const managedExtension = policyRoot?.ExtensionSettings?.[extensionId] ?? null;
  return {
    path: policy.path,
    managedExtension:
      managedExtension && typeof managedExtension === 'object'
        ? {
            installation_mode: managedExtension.installation_mode ?? null,
            install_url: managedExtension.install_url ?? null,
          }
        : null,
    parseError: parsed.parseError ?? null,
  };
}

function canExecute(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readNativeHostManifest() {
  const candidates = [];

  for (const manifestPath of NATIVE_HOST_MANIFEST_CANDIDATES) {
    if (!existsSync(manifestPath)) {
      candidates.push({ path: manifestPath, exists: false });
      continue;
    }

    const text = readFileSync(manifestPath, 'utf8');
    const parsed = safeJsonParse(text);
    const nativeHostPath = typeof parsed.path === 'string' ? parsed.path : '';
    candidates.push({
      path: manifestPath,
      exists: true,
      name: parsed.name ?? null,
      type: parsed.type ?? null,
      nativeHostPath: nativeHostPath || null,
      nativeHostExecutable: nativeHostPath ? canExecute(nativeHostPath) : false,
      allowed_extensions: Array.isArray(parsed.allowed_extensions) ? parsed.allowed_extensions : [],
      parseError: parsed.parseError ?? null,
    });
  }

  return {
    expectedName: NATIVE_HOST_NAME,
    selected: candidates.find((candidate) => candidate.exists) ?? null,
    candidates,
  };
}

function extractExtensionUuid(prefsContent, extensionId) {
  const match = prefsContent.match(
    /user_pref\("extensions\.webextensions\.uuids",\s*"((?:\\.|[^"])*)"\);/
  );
  if (!match) {
    return null;
  }

  const uuidJson = JSON.parse(`"${match[1]}"`);
  const uuidMap = JSON.parse(uuidJson);
  return typeof uuidMap[extensionId] === 'string' ? uuidMap[extensionId] : null;
}

async function waitForExtensionUuid(profileDir, extensionId, timeoutMs) {
  const prefsPath = join(profileDir, 'prefs.js');
  const deadline = Date.now() + timeoutMs;
  let latestPrefs = '';

  while (Date.now() < deadline) {
    if (existsSync(prefsPath)) {
      latestPrefs = readFileSync(prefsPath, 'utf8');
      const uuid = extractExtensionUuid(latestPrefs, extensionId);
      if (uuid) {
        return uuid;
      }
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(
    `Firefox did not register extension UUID for ${extensionId}; prefs.js length=${latestPrefs.length}`
  );
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeGitHubErrorAnnotation(message) {
  const summary = String(message).split('\n')[0].slice(0, 500);
  const escaped = summary.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  process.stdout.write(`::error title=Linux Firefox blocked-page canary::${escaped}\n`);
}

function writeInlineDiagnosticsSummary(evidence) {
  const summary = {
    status: evidence.status,
    blockedUrl: evidence.blockedUrl,
    blockedHostname: evidence.blockedHostname,
    firefoxBinary: evidence.firefoxBinary,
    policy: evidence.policySummary,
    nativeHostManifest: evidence.nativeHostManifest,
    extensionUuid: evidence.extensionUuid,
    extensionDiagnostics: evidence.extensionDiagnostics,
    currentUrl: evidence.currentUrl,
    title: evidence.title,
    error: evidence.error ? String(evidence.error).split('\n')[0] : null,
  };

  process.stdout.write(
    `[linux-firefox-block-page-canary] Diagnostics summary\n${JSON.stringify(summary, null, 2)}\n`
  );
}

async function writeDiagnostics(driver, diagnosticsDir, name) {
  mkdirSync(diagnosticsDir, { recursive: true });
  const basePath = join(diagnosticsDir, name);

  try {
    writeFileSync(`${basePath}.html`, await driver.getPageSource(), 'utf8');
  } catch {
    writeFileSync(`${basePath}.html`, 'Page source unavailable\n', 'utf8');
  }

  try {
    writeFileSync(`${basePath}.png`, await driver.takeScreenshot(), 'base64');
  } catch {
    writeFileSync(`${basePath}.png.txt`, 'Screenshot unavailable\n', 'utf8');
  }

  try {
    writeJson(`${basePath}.json`, {
      currentUrl: await driver.getCurrentUrl(),
      title: await driver.getTitle(),
    });
  } catch {
    writeJson(`${basePath}.json`, {
      currentUrl: null,
      title: null,
    });
  }
}

export async function quitDriverQuietly(driver, evidence = {}, logger = console) {
  try {
    await driver.quit();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    evidence.cleanupError = message;
    logger.warn(`[linux-firefox-block-page-canary] Firefox driver cleanup failed: ${message}`);
  }
}

async function queryExtensionDiagnostics(driver, extensionUuid, blockedHostname, timeoutMs) {
  const diagnosticsUrl = `moz-extension://${extensionUuid}/blocked/blocked.html?domain=${encodeURIComponent(
    blockedHostname
  )}&error=OPENPATH_DIAGNOSTIC&origin=linux-firefox-canary`;

  await driver.get(diagnosticsUrl);
  await driver.wait(until.elementLocated(By.css('#blocked-domain')), timeoutMs);

  return await driver.executeAsyncScript(
    `
const domain = arguments[0];
const done = arguments[arguments.length - 1];
const runtime =
  (globalThis.browser && globalThis.browser.runtime) ||
  (globalThis.chrome && globalThis.chrome.runtime);

if (!runtime || typeof runtime.sendMessage !== 'function') {
  done({ success: false, error: 'browser.runtime.sendMessage is unavailable' });
  return;
}

Promise.resolve(runtime.sendMessage({
  action: 'getOpenPathDiagnostics',
  domains: [domain],
})).then(
  (response) => done(response),
  (error) => done({
    success: false,
    error: error && (error.stack || error.message) ? String(error.stack || error.message) : String(error),
  })
);
`,
    blockedHostname
  );
}

function assertExtensionDiagnosticsBlocksHostname(diagnostics, blockedHostname) {
  assert.equal(
    diagnostics?.success,
    true,
    `Extension diagnostics failed: ${JSON.stringify(diagnostics)}`
  );
  assert.equal(
    diagnostics?.nativeAvailable,
    true,
    `Firefox native messaging host is not available: ${JSON.stringify(diagnostics)}`
  );
  assert.equal(
    diagnostics?.nativeCheck?.success,
    true,
    `Native check failed: ${JSON.stringify(diagnostics?.nativeCheck)}`
  );

  const nativeResult = diagnostics.nativeCheck.results?.find(
    (result) => result?.domain === blockedHostname
  );
  assert.ok(nativeResult, `Native check did not return ${blockedHostname}`);
  assert.equal(
    nativeResult.inWhitelist,
    false,
    `Native check says ${blockedHostname} is whitelisted`
  );
  assert.equal(nativeResult.resolves, false, `Native check says ${blockedHostname} resolves`);
  assert.notEqual(
    nativeResult.policyActive,
    false,
    `Native check says DNS policy is inactive for ${blockedHostname}`
  );
}

async function main() {
  const blockedUrl = valueOrFallback(
    process.env.LINUX_FIREFOX_BLOCK_PAGE_CANARY_URL,
    DEFAULT_BLOCKED_URL
  );
  const extensionId = valueOrFallback(process.env.EXPECTED_EXTENSION_ID, DEFAULT_EXTENSION_ID);
  const timeoutMs = Number.parseInt(
    valueOrFallback(process.env.LINUX_FIREFOX_BLOCK_PAGE_TIMEOUT_MS, String(DEFAULT_TIMEOUT_MS)),
    10
  );
  const outputPath = resolve(
    valueOrFallback(
      process.env.LINUX_FIREFOX_BLOCK_PAGE_CANARY_OUTPUT,
      'production-linux-firefox-block-page-canary.json'
    )
  );
  const diagnosticsDir = resolve(
    valueOrFallback(
      process.env.LINUX_FIREFOX_BLOCK_PAGE_CANARY_DIAGNOSTICS_DIR,
      join(process.env.RUNNER_TEMP ?? process.cwd(), 'linux-firefox-block-page-canary')
    )
  );
  const blockedHostname = new URL(blockedUrl).hostname;

  let driver = null;
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'failed',
    blockedUrl,
    blockedHostname,
    extensionId,
    firefoxBinary: null,
    policyPath: null,
    policySummary: null,
    nativeHostManifest: null,
    extensionUuid: null,
    extensionDiagnostics: null,
    currentUrl: null,
    title: null,
    blockedDomainText: null,
    error: null,
  };

  try {
    const firefoxBinary = resolveFirefoxBinary();
    const policy = readFirefoxPolicy(extensionId);
    evidence.firefoxBinary = firefoxBinary;
    evidence.policyPath = policy.path;
    evidence.policySummary = summarizeFirefoxPolicy(policy, extensionId);
    evidence.nativeHostManifest = readNativeHostManifest();

    assert.ok(policy.path, `Firefox policies.json did not reference ${extensionId}`);
    assert.ok(
      policy.text.includes('"installation_mode"') && policy.text.includes('force_installed'),
      'Firefox policies.json did not force-install the OpenPath extension'
    );

    const options = new firefox.Options();
    options.setBinary(firefoxBinary);
    options.addArguments('-headless');
    options.setPreference('network.dns.disablePrefetch', true);
    options.setPreference('network.trr.mode', 5);
    options.setPreference('network.trr.uri', '');
    options.setPreference('network.dnsCacheExpiration', 0);
    options.setPreference('network.dnsCacheExpirationGracePeriod', 0);

    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
    await driver.manage().setTimeouts({ implicit: 1000, pageLoad: 8000, script: 10000 });
    await driver.get('about:blank');

    const capabilities = await driver.getCapabilities();
    const profileDir = capabilities.get('moz:profile');
    assert.equal(typeof profileDir, 'string', 'Firefox did not expose moz:profile');
    evidence.extensionUuid = await waitForExtensionUuid(profileDir, extensionId, timeoutMs);
    evidence.extensionDiagnostics = await queryExtensionDiagnostics(
      driver,
      evidence.extensionUuid,
      blockedHostname,
      timeoutMs
    );
    assertExtensionDiagnosticsBlocksHostname(evidence.extensionDiagnostics, blockedHostname);
    writeInlineDiagnosticsSummary(evidence);

    try {
      await driver.get(blockedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('Navigation timed out') &&
        !message.includes('Reached error page') &&
        !message.includes('NS_ERROR')
      ) {
        throw error;
      }
    }

    await driver.wait(async () => {
      const currentUrl = await driver.getCurrentUrl();
      return (
        currentUrl.startsWith(`moz-extension://${evidence.extensionUuid}/`) &&
        currentUrl.includes('/blocked/blocked.html')
      );
    }, timeoutMs);

    const domainElement = await driver.wait(
      until.elementLocated(By.css('#blocked-domain')),
      timeoutMs
    );
    const blockedDomainText = (await domainElement.getText()).trim();
    assert.equal(
      blockedDomainText,
      blockedHostname,
      `Blocked page rendered for ${blockedDomainText}, expected ${blockedHostname}`
    );

    evidence.currentUrl = await driver.getCurrentUrl();
    evidence.title = await driver.getTitle();
    evidence.blockedDomainText = blockedDomainText;
    evidence.status = 'success';
    await writeDiagnostics(driver, diagnosticsDir, 'success');
    writeJson(outputPath, evidence);
    writeInlineDiagnosticsSummary(evidence);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack || error.message : String(error);
    writeGitHubErrorAnnotation(evidence.error);
    if (driver) {
      await writeDiagnostics(driver, diagnosticsDir, 'failure');
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
    }
    writeJson(outputPath, evidence);
    writeInlineDiagnosticsSummary(evidence);
    throw error;
  } finally {
    if (driver) {
      await quitDriverQuietly(driver, evidence);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
