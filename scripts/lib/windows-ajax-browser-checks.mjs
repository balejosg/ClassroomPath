/**
 * Browser-level checks for the Windows AJAX canary: verifies extension installation, CSP headers, and navigation outcomes.
 *
 * Invoked by: Imported by `windows-ajax-auto-allow-runtime.mjs`.
 * Usage: (library module, not invoked directly)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
  WINDOWS_AUTO_ALLOW_ORIGIN_HOST as ORIGIN_HOST,
  redactWindowsCanaryObject,
} from './windows-auto-allow-canary-evidence.mjs';

const FIREFOX_MODE = process.env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE ?? 'managed';
const EXPECTED_EXTENSION_ID = process.env.EXPECTED_EXTENSION_ID ?? 'monitor-bloqueos@openpath';
const REDDIT_NAVIGATION_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS ?? '45000',
  10
);
const EXTERNAL_ALLOWLISTED_NAVIGATION_TIMEOUT_MS = Number.parseInt(
  process.env.WINDOWS_EXTERNAL_ALLOWLISTED_NAVIGATION_TIMEOUT_MS ?? '45000',
  10
);
const BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN =
  process.env.WINDOWS_BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN ??
  'blocked-page-unblock-request.127.0.0.1.sslip.io';
const PERMISSIONS_USER_INPUT_HANDLER_ERROR =
  'permissions.request may only be called from a user input handler';
const BLOCKED_PAGE_UNBLOCK_REQUEST_SUCCESS_PATTERN = /\bRequest sent\b|Solicitud enviada/i;

export function isBlockedPageUnblockRequestSuccessText(text) {
  return BLOCKED_PAGE_UNBLOCK_REQUEST_SUCCESS_PATTERN.test(String(text ?? ''));
}

export function normalizeRedditNavigationMode(mode) {
  return ['off', 'diagnostic', 'gate'].includes(mode) ? mode : 'off';
}

export function buildRedditNavigationSkippedEvidence(mode, pageEvidence = {}) {
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
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP method not allowed/i.test(message)) {
      return [];
    }
    return [{ level: 'unavailable', message }];
  }
}

export async function collectRedditRealNavigationDiagnostics({
  driver,
  mode = 'off',
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

export function buildBlockedPageUnblockRequestSkippedEvidence(reason, config = null) {
  const extensionSource = config?.useLocalFirefoxAddon ? 'local' : 'managed';
  return {
    success: false,
    skipped: true,
    reason,
    permissionsMonkeypatch: false,
    extensionSource,
    firefoxMode: config?.useLocalFirefoxAddon
      ? 'selenium-local-addon'
      : config?.useSeleniumFirefox
        ? 'selenium-managed'
        : FIREFOX_MODE,
    blockedPageDomain:
      config?.blockedPageUnblockRequestDomain ?? BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN,
    blockedPageUrl: null,
    statusText: '',
    errorText: reason,
    userInputHandlerError: reason.includes(PERMISSIONS_USER_INPUT_HANDLER_ERROR),
    errors: [{ message: reason }],
  };
}

export async function discoverExtensionBaseUrlFromProfile(
  profileDir,
  expectedExtensionId = EXPECTED_EXTENSION_ID
) {
  const registryPath = join(profileDir, 'extensions.json');
  const prefsPath = join(profileDir, 'prefs.js');
  let prefsDiscovery = null;
  try {
    const prefsContent = await readFile(prefsPath, 'utf8');
    const match = prefsContent.match(
      /user_pref\("extensions\.webextensions\.uuids",\s*"((?:\\.|[^"])*)"\);/
    );
    if (match) {
      const uuidJson = JSON.parse(`"${match[1]}"`);
      const uuidMap = JSON.parse(uuidJson);
      const extensionUuid =
        typeof uuidMap?.[expectedExtensionId] === 'string' ? uuidMap[expectedExtensionId] : null;
      prefsDiscovery = {
        success: extensionUuid !== null,
        prefsPath,
        expectedExtensionId,
        extensionUuid,
        baseUrl: extensionUuid ? `moz-extension://${extensionUuid}/` : null,
        uuidMapKeys: Object.keys(uuidMap ?? {}),
      };
      if (prefsDiscovery.baseUrl) {
        return prefsDiscovery;
      }
    }
  } catch (error) {
    prefsDiscovery = {
      success: false,
      prefsPath,
      expectedExtensionId,
      baseUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    const addon = registry?.addons?.find((candidate) => candidate?.id === expectedExtensionId);
    const candidates = [
      addon?.rootURI,
      addon?.baseURL,
      addon?.locationURI,
      addon?.resourceURI,
    ].filter((value) => typeof value === 'string' && value.startsWith('moz-extension://'));
    const baseUrl = candidates[0] ?? null;
    return {
      success: baseUrl !== null,
      registryPath,
      expectedExtensionId,
      baseUrl,
      prefs: prefsDiscovery,
      addonPresent: addon !== undefined,
      addonActive: addon?.active ?? null,
      addonVersion: addon?.version ?? null,
    };
  } catch (error) {
    return {
      success: false,
      registryPath,
      expectedExtensionId,
      baseUrl: null,
      prefs: prefsDiscovery,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildBlockedPageUrl(extensionBaseUrl, domain) {
  const baseUrl = extensionBaseUrl.endsWith('/') ? extensionBaseUrl : `${extensionBaseUrl}/`;
  const url = new URL('blocked/blocked.html', baseUrl);
  url.searchParams.set('domain', domain);
  url.searchParams.set('blockedUrl', `https://${domain}/`);
  url.searchParams.set('origin', `https://${ORIGIN_HOST}/`);
  url.searchParams.set('error', 'WINDOWS_AJAX_DIRECT_BLOCKED_PAGE_UNBLOCK_REQUEST_CANARY');
  return url.toString();
}

async function collectExtensionRuntimeDiagnostics(driver, domains) {
  try {
    return await driver.executeAsyncScript(
      `
const domains = arguments[0];
const done = arguments[arguments.length - 1];
try {
  const runtime = globalThis.browser && globalThis.browser.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    done({ success: false, error: 'browser.runtime.sendMessage unavailable' });
    return;
  }
  Promise.resolve(runtime.sendMessage({ action: 'getOpenPathDiagnostics', domains }))
    .then((response) => done(response))
    .catch((error) => done({ success: false, error: String(error && error.message ? error.message : error) }));
} catch (error) {
  done({ success: false, error: String(error && error.message ? error.message : error) });
}
`,
      domains
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runBlockedPageUnblockRequestCheck({
  driver,
  profileDir,
  firefoxExtensionWarmup,
  config,
}) {
  const extensionSource = config.useLocalFirefoxAddon ? 'local' : 'managed';
  const firefoxMode =
    firefoxExtensionWarmup?.mode ??
    (config.useLocalFirefoxAddon
      ? 'selenium-local-addon'
      : config.useSeleniumFirefox
        ? 'selenium-managed'
        : FIREFOX_MODE);
  const blockedPageDomain =
    config.blockedPageUnblockRequestDomain ?? BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN;
  const discovery = await discoverExtensionBaseUrlFromProfile(
    String(firefoxExtensionWarmup?.profileDir ?? profileDir),
    config.expectedExtensionId ?? EXPECTED_EXTENSION_ID
  );
  if (!discovery.baseUrl) {
    return redactWindowsCanaryObject({
      ...buildBlockedPageUnblockRequestSkippedEvidence(
        discovery.error ?? 'Firefox extension moz-extension base URL was not discoverable',
        config
      ),
      skipped: false,
      extensionSource,
      firefoxMode,
      discovery,
    });
  }

  const blockedPageUrl = buildBlockedPageUrl(discovery.baseUrl, blockedPageDomain);
  const startedAt = Date.now();
  let navigationError = null;
  let statusText = '';
  let errorText = '';
  let pageSnapshot = null;
  let submitClicked = false;
  let extensionDiagnosticsBeforeSubmit = null;
  let extensionDiagnosticsAfterSubmit = null;

  try {
    const { By } = await import('selenium-webdriver');
    await driver.manage().setTimeouts({
      pageLoad: config.blockedPageUnblockRequestTimeoutMs,
      script: 15_000,
      implicit: 2_000,
    });
    await driver.get(blockedPageUrl);
    extensionDiagnosticsBeforeSubmit = await collectExtensionRuntimeDiagnostics(driver, [
      blockedPageDomain,
    ]);
    const reasonInput = await driver.findElement(By.id('request-reason'));
    await reasonInput.clear();
    await reasonInput.sendKeys('Windows direct canary blocked-page unblock request');
    const submitButton = await driver.findElement(By.id('submit-unblock-request'));
    await submitButton.click();
    submitClicked = true;
    const statusElement = await driver.findElement(By.id('request-status'));
    await driver
      .wait(async () => {
        const text = String(await statusElement.getText()).trim();
        if (isBlockedPageUnblockRequestSuccessText(text)) {
          return text;
        }
        if (
          text.length > 0 &&
          !/Enviando solicitud/i.test(text) &&
          /no es compatible|avisa a tu profesor|error|fall[oó]|no se pudo/i.test(text)
        ) {
          return text;
        }
        return false;
      }, config.blockedPageUnblockRequestTimeoutMs)
      .catch(() => null);
    statusText = String(await statusElement.getText()).trim();
    extensionDiagnosticsAfterSubmit = await collectExtensionRuntimeDiagnostics(driver, [
      blockedPageDomain,
    ]);
    pageSnapshot = await driver.executeScript(`
const status = document.getElementById('request-status');
const bodyText = document.body ? document.body.innerText : '';
return {
  href: location.href,
  title: document.title,
  readyState: document.readyState,
  statusText: status ? (status.textContent || '') : '',
  statusClass: status ? (status.className || '') : '',
  bodyText: bodyText.slice(0, 4000)
};
`);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const browserErrors = await collectBrowserLogErrors(driver);
  const combinedText = [
    statusText,
    pageSnapshot?.statusText,
    pageSnapshot?.bodyText,
    navigationError,
    ...browserErrors.map((entry) => entry.message),
  ]
    .filter(Boolean)
    .join('\n');
  const userInputHandlerError = combinedText.includes(PERMISSIONS_USER_INPUT_HANDLER_ERROR);
  errorText = userInputHandlerError
    ? PERMISSIONS_USER_INPUT_HANDLER_ERROR
    : (navigationError ?? '');
  const pageVisibleText = [statusText, pageSnapshot?.statusText, pageSnapshot?.bodyText]
    .filter(Boolean)
    .join('\n');
  const statusIndicatesSuccess = isBlockedPageUnblockRequestSuccessText(pageVisibleText);
  const statusIndicatesError =
    userInputHandlerError ||
    /no es compatible|avisa a tu profesor|error|fall[oó]|no se pudo/i.test(combinedText);
  const success =
    navigationError === null && submitClicked && statusIndicatesSuccess && !statusIndicatesError;

  return redactWindowsCanaryObject({
    success,
    permissionsMonkeypatch: false,
    permissionStrategy: 'required-data-collection',
    extensionSource,
    firefoxMode,
    blockedPageDomain,
    blockedPageUrl,
    statusText: statusText || pageSnapshot?.statusText || '',
    errorText,
    userInputHandlerError,
    submitClicked,
    elapsedMs: Date.now() - startedAt,
    discovery,
    extensionDiagnosticsBeforeSubmit,
    extensionDiagnosticsAfterSubmit,
    page: pageSnapshot,
    errors: [...(navigationError ? [{ message: navigationError }] : []), ...browserErrors].slice(
      -20
    ),
  });
}

export function buildAllowlistedNavigationSkippedEvidence(reason) {
  return {
    url: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
    expectedHosts: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
    finalHost: null,
    href: null,
    title: null,
    success: false,
    skipped: true,
    reason,
    blockedByOpenPath: false,
    timedOut: false,
    metrics: null,
    resourceHosts: [],
    errors: [{ message: reason }],
  };
}

function collectAllowlistedNavigationMetricsScript() {
  return `
const navigation = performance.getEntriesByType('navigation')[0];
const resourceHosts = [...new Set(performance.getEntriesByType('resource')
  .map((entry) => {
    try { return new URL(entry.name).hostname; } catch { return ''; }
  })
  .filter(Boolean))].slice(0, 50);
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

function parseNavigationHost(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesExpected(host, expectedHost) {
  const normalizedHost = String(host ?? '')
    .trim()
    .toLowerCase();
  const normalizedExpectedHost = String(expectedHost ?? '')
    .trim()
    .toLowerCase();
  return (
    normalizedHost === normalizedExpectedHost ||
    normalizedHost.endsWith(`.${normalizedExpectedHost}`)
  );
}

export async function collectAllowlistedExternalNavigationDiagnostics({
  driver,
  url = WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
  expectedHosts = WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
  timeoutMs = EXTERNAL_ALLOWLISTED_NAVIGATION_TIMEOUT_MS,
}) {
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
    page = await driver.executeScript(collectAllowlistedNavigationMetricsScript());
  } catch (error) {
    navigationError = navigationError ?? (error instanceof Error ? error.message : String(error));
  }

  const browserErrors = await collectBrowserLogErrors(driver);
  const errors = [
    ...(navigationError ? [{ message: navigationError }] : []),
    ...browserErrors,
  ].slice(-20);
  const finalHost = parseNavigationHost(page?.href);
  const hostAllowed = expectedHosts.some((expectedHost) =>
    hostMatchesExpected(finalHost, expectedHost)
  );
  const blockedByOpenPath = page?.blockedByOpenPath === true;
  const success = navigationError === null && !timedOut && !blockedByOpenPath && hostAllowed;

  return redactWindowsCanaryObject({
    url,
    expectedHosts,
    finalHost,
    hostAllowed,
    href: page?.href ?? null,
    title: page?.title ?? null,
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
  });
}
