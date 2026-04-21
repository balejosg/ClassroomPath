#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { Builder, By, until } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';

const DEFAULT_EXTENSION_ID = 'monitor-bloqueos@openpath';
const DEFAULT_BLOCKED_URL = 'https://www.mozilla.org/';
const DEFAULT_TIMEOUT_MS = 30000;

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
    extensionUuid: null,
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
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack || error.message : String(error);
    if (driver) {
      await writeDiagnostics(driver, diagnosticsDir, 'failure');
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
    }
    writeJson(outputPath, evidence);
    throw error;
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}

await main();
