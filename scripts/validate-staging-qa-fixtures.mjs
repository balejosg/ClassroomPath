#!/usr/bin/env node

/**
 * Validates that the QA fixtures applied to staging are consistent with the expected fixture schema using Playwright.
 *
 * Invoked by: Developer CLI for QA fixture validation before smoke tests.
 * Usage: node scripts/validate-staging-qa-fixtures.mjs --fixture <name>
 * Env: STAGING_API_URL, PLAYWRIGHT_HEADLESS.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { chromium, firefox } from 'playwright';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const value = process.argv[index + 1]?.startsWith('--') ? '1' : (process.argv[++index] ?? '1');
  args.set(key, value);
}

const manifestPath = resolve(
  process.cwd(),
  args.get('manifest') ?? 'config/staging-qa-fixtures.json'
);
const browserName = args.get('browser') ?? 'firefox';
const renderTimeoutMs = Number.parseInt(args.get('render-timeout-ms') ?? '10000', 10);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const browserType = browserName === 'chromium' ? chromium : firefox;
const browser = await browserType.launch({ headless: true });
const failures = [];

try {
  for (const fixture of manifest.fixtures ?? []) {
    validateRule(`${fixture.group}: blockedSubdomain`, fixture.blockedSubdomain, {
      expectedType: 'hostname',
    });
    validateRule(`${fixture.group}: blockedPath`, fixture.blockedPath, {
      expectedType: 'hostPath',
    });
    await validateUrl(`${fixture.group}: allowed`, fixture.allowed, { mustRender: true });
    await validateUrl(`${fixture.group}: allowedAjax`, fixture.allowedAjax, {
      mustRender: true,
      ajaxSelector: '#qa-ajax-result',
      ajaxText: 'loaded',
    });
    await validateUrl(`${fixture.group}: requestAccess`, fixture.requestAccess, {
      mustRender: false,
    });
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${manifest.fixtures.length} staging QA fixture groups from ${manifestPath}`);

function validateRule(label, value, options) {
  if (typeof value !== 'string' || value.trim() === '') {
    failures.push(`${label}: missing rule value`);
    return;
  }

  const trimmed = value.trim();
  if (options.expectedType === 'hostname') {
    if (trimmed.includes('/') || trimmed.includes(':')) {
      failures.push(`${label}: expected hostname only, got ${trimmed}`);
      return;
    }
    return;
  }

  if (options.expectedType === 'hostPath') {
    if (!trimmed.includes('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      failures.push(`${label}: expected host/path without scheme, got ${trimmed}`);
    }
  }
}

async function validateUrl(label, urlText, options) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    failures.push(`${label}: invalid URL ${urlText}`);
    return;
  }

  try {
    await lookup(url.hostname);
  } catch (error) {
    failures.push(`${label}: DNS lookup failed for ${url.hostname}: ${error.message}`);
    return;
  }

  let response;
  try {
    response = await fetch(url, { redirect: 'manual' });
  } catch (error) {
    failures.push(`${label}: fetch failed: ${error.message}`);
    return;
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? '';
    failures.push(`${label}: redirects to ${location || '<missing location>'}`);
    return;
  }

  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    failures.push(`${label}: unsuitable HTTP status ${response.status}`);
    return;
  }

  if (!options.mustRender) {
    return;
  }

  const page = await browser.newPage();
  try {
    const navigation = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: renderTimeoutMs,
    });
    const status = navigation?.status() ?? 0;
    if (status >= 400) {
      failures.push(`${label}: browser navigation status ${status}`);
      return;
    }

    await page.locator('[data-qa-fixture]').waitFor({ timeout: renderTimeoutMs });
    if (options.ajaxSelector) {
      await page.waitForFunction(
        ({ selector, text }) => document.querySelector(selector)?.textContent === text,
        { selector: options.ajaxSelector, text: options.ajaxText },
        { timeout: renderTimeoutMs }
      );
    }
  } catch (error) {
    failures.push(`${label}: browser render failed: ${error.message}`);
  } finally {
    await page.close();
  }
}
