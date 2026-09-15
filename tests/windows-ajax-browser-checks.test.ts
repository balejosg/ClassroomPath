import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildBlockedPageUnblockRequestSkippedEvidence,
  buildRedditNavigationSkippedEvidence,
  collectAllowlistedExternalNavigationDiagnostics,
  collectRedditRealNavigationDiagnostics,
  discoverExtensionBaseUrlFromProfile,
  runBlockedPageUnblockRequestCheck,
} from '../scripts/lib/windows-ajax-browser-checks.mjs';

function createDriver({
  page,
  statusText = '',
  browserLogs = [],
  navigationError = null,
  privilegedScriptsUnsupported = false,
  delayedBlockedPageInitialization = false,
  staleBlockedDomainReadOnce = false,
  deadBlockedDomainReadOnce = false,
  staleReasonInputClearOnce = false,
  deadReasonValueOnce = false,
  staleSubmitClickOnce = false,
  resetReasonBeforeFirstSubmitLookup = false,
} = {}) {
  const calls: string[] = [];
  const scriptCalls: string[] = [];
  let blockedDomainReads = 0;
  let staleBlockedDomain = staleBlockedDomainReadOnce;
  let deadBlockedDomain = deadBlockedDomainReadOnce;
  let staleReasonInput = staleReasonInputClearOnce;
  let deadReasonValue = deadReasonValueOnce;
  let staleSubmitClick = staleSubmitClickOnce;
  let resetReasonBeforeSubmitLookup = resetReasonBeforeFirstSubmitLookup;
  let reasonValue = '';
  let submitStarted = false;
  const currentStatusText = () => (submitStarted ? statusText : '');
  const statusElement = {
    getText: async () => currentStatusText(),
    getDomProperty: async (name: string) => (name === 'textContent' ? currentStatusText() : null),
    getAttribute: async (name: string) => {
      if (privilegedScriptsUnsupported) {
        throw new Error(
          'ExecuteScript and ExecuteAsyncScript are not supported for privileged browsing contexts: 13'
        );
      }
      return name === 'class' ? 'success' : null;
    },
  };
  const elements = {
    'request-reason': {
      clear: async () => {
        if (staleReasonInput) {
          staleReasonInput = false;
          throw new Error(
            'The element with the reference fake-reason is stale; either its node document is not the active document, or it is no longer connected to the DOM'
          );
        }
        reasonValue = '';
        calls.push('clear-reason');
      },
      sendKeys: async (value: string) => {
        reasonValue += value;
        calls.push('send-reason');
      },
      getProperty: async (name: string) => {
        if (name === 'value' && deadReasonValue) {
          deadReasonValue = false;
          throw new Error("TypeError: can't access dead object");
        }
        return name === 'value' ? reasonValue : null;
      },
    },
    'submit-unblock-request': {
      click: async () => {
        if (delayedBlockedPageInitialization && blockedDomainReads < 2) {
          throw new Error('blocked page handler is not initialized');
        }
        if (staleSubmitClick) {
          staleSubmitClick = false;
          submitStarted = true;
          calls.push('submit-stale');
          throw new Error(
            'The element with the reference fake-submit is stale; either its node document is not the active document, or it is no longer connected to the DOM'
          );
        }
        if (!reasonValue) {
          calls.push('submit-empty');
          return;
        }
        submitStarted = true;
        calls.push('submit');
      },
      getProperty: async (name: string) => (name === 'disabled' ? false : null),
    },
    'request-status': statusElement,
    'blocked-domain': {
      getText: async () => {
        if (staleBlockedDomain) {
          staleBlockedDomain = false;
          throw new Error(
            'The element with the reference fake-domain is stale; either its node document is not the active document, or it is no longer connected to the DOM'
          );
        }
        return 'blocked.example.test';
      },
      getDomProperty: async () => {
        blockedDomainReads += 1;
        if (deadBlockedDomain) {
          deadBlockedDomain = false;
          throw new Error("TypeError: can't access dead object");
        }
        if (staleBlockedDomain) {
          return null;
        }
        return delayedBlockedPageInitialization && blockedDomainReads === 1
          ? '-'
          : 'blocked.example.test';
      },
    },
  };

  return {
    calls,
    manage: () => ({
      setTimeouts: async () => {},
      logs: () => ({
        get: async () => browserLogs,
      }),
    }),
    get: async (url: string) => {
      calls.push(`get:${url}`);
      if (navigationError) throw new Error(navigationError);
    },
    getCurrentUrl: async () => 'moz-extension://uuid/blocked/blocked.html',
    getTitle: async () => 'Blocked',
    scriptCalls,
    executeScript: async (script: string) => {
      if (privilegedScriptsUnsupported) {
        throw new Error(
          'ExecuteScript and ExecuteAsyncScript are not supported for privileged browsing contexts: 13'
        );
      }
      scriptCalls.push(script);
      return script.includes('document.getElementById')
        ? ({
            href: 'moz-extension://uuid/blocked/blocked.html',
            title: 'Blocked',
            readyState: 'complete',
            statusText,
            statusClass: 'success',
            bodyText: statusText,
          } as const)
        : page;
    },
    executeAsyncScript: async () => {
      if (privilegedScriptsUnsupported) {
        throw new Error(
          'ExecuteScript and ExecuteAsyncScript are not supported for privileged browsing contexts: 13'
        );
      }
      return { success: true };
    },
    findElement: async (locator: { value?: string }) => {
      const rawValue = String(locator.value ?? '');
      const id = rawValue.match(/\[id="([^"]+)"\]/)?.[1] ?? rawValue;
      if (id === 'submit-unblock-request' && resetReasonBeforeSubmitLookup) {
        resetReasonBeforeSubmitLookup = false;
        reasonValue = '';
      }
      return elements[id];
    },
    wait: async (predicate: () => Promise<unknown>) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await predicate();
        if (result) return result;
      }
      return false;
    },
  };
}

describe('Windows AJAX browser checks', () => {
  test('discovers extension base URL from Firefox prefs before registry fallback', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      const uuidMap = JSON.stringify({ 'monitor-bloqueos@openpath': 'extension-uuid' }).replace(
        /"/g,
        '\\"'
      );
      await writeFile(
        join(tempDir, 'prefs.js'),
        `user_pref("extensions.webextensions.uuids", "${uuidMap}");`,
        'utf8'
      );

      const discovery = await discoverExtensionBaseUrlFromProfile(tempDir);

      assert.equal(discovery.success, true);
      assert.equal(discovery.baseUrl, 'moz-extension://extension-uuid/');
      assert.equal(discovery.extensionUuid, 'extension-uuid');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('reports extension base URL discovery failure as blocked-page evidence', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      const driver = createDriver();
      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'missing@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, false);
      assert.equal(evidence.skipped, false);
      assert.equal(evidence.permissionsMonkeypatch, false);
      assert.equal(evidence.permissionStrategy, undefined);
      assert.equal(evidence.discovery.success, false);
      assert.equal(evidence.blockedPageDomain, 'blocked.example.test');
      assert.equal(evidence.blockedPageUrl, null);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('collects blocked-page unblock request evidence without permission monkeypatching', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({ statusText: 'Request sent. It remains pending.' });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.equal(evidence.permissionsMonkeypatch, false);
      assert.equal(evidence.permissionStrategy, 'required-data-collection');
      assert.equal(evidence.submitClicked, true);
      assert.match(evidence.blockedPageUrl, /^moz-extension:\/\/uuid\/blocked\/blocked\.html/);
      assert.equal(evidence.blockedPageNavigationUrl, 'http://blocked.example.test/');
      assert.ok(driver.calls.includes('get:http://blocked.example.test/'));
      assert.ok(driver.calls.includes('submit'));
      assert.equal(driver.scriptCalls.length, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('uses WebDriver element commands when privileged extension scripts are unsupported', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        privilegedScriptsUnsupported: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.equal(evidence.statusText, 'Request sent. It remains pending.');
      assert.equal(evidence.page.href, 'moz-extension://uuid/blocked/blocked.html');
      assert.equal(evidence.page.statusClass, '');
      assert.equal(evidence.extensionDiagnosticsBeforeSubmit.success, false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('records blocked-page form state when a click leaves no request status', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({ statusText: '' });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, false);
      assert.deepEqual(evidence.formStateBeforeSubmit, {
        reasonLength: 'Windows direct canary blocked-page unblock request'.length,
        reasonMatchesExpected: true,
        submitDisabled: false,
        statusText: '',
      });
      assert.deepEqual(evidence.formStateAfterSubmit, {
        reasonLength: 'Windows direct canary blocked-page unblock request'.length,
        reasonMatchesExpected: true,
        submitDisabled: false,
        statusText: '',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('waits for blocked-page initialization before clicking submit', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        delayedBlockedPageInitialization: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.ok(driver.calls.includes('submit'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('retries a Firefox dead object before the unblock click', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        deadReasonValueOnce: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.equal(evidence.submitClicked, true);
      assert.ok(driver.calls.includes('submit'));
      assert.equal(
        driver.calls.filter((call: string) => call === 'clear-reason').length,
        3,
        'the click must wait for two consecutive live form observations after recovery'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('reacquires blocked-page elements replaced before a user click', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        staleBlockedDomainReadOnce: true,
        staleReasonInputClearOnce: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.equal(evidence.submitClicked, true);
      assert.deepEqual(
        driver.calls.filter((call: string) => call === 'clear-reason'),
        ['clear-reason', 'clear-reason']
      );
      assert.deepEqual(
        driver.calls.filter((call: string) => call === 'submit'),
        ['submit']
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('refills a reset blocked-page reason before the single submit click', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        resetReasonBeforeFirstSubmitLookup: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.deepEqual(
        driver.calls.filter((call: string) => call === 'clear-reason'),
        ['clear-reason', 'clear-reason', 'clear-reason']
      );
      assert.deepEqual(
        driver.calls.filter((call: string) => call === 'submit'),
        ['submit']
      );
      assert.deepEqual(
        driver.calls.filter((call: string) => call === 'submit-empty'),
        []
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('accepts submitted status after a stale user click without retrying the request', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-browser-checks-'));
    try {
      await writeFile(
        join(tempDir, 'extensions.json'),
        JSON.stringify({
          addons: [{ id: 'monitor-bloqueos@openpath', rootURI: 'moz-extension://uuid/' }],
        }),
        'utf8'
      );
      const driver = createDriver({
        statusText: 'Request sent. It remains pending.',
        staleSubmitClickOnce: true,
      });

      const evidence = await runBlockedPageUnblockRequestCheck({
        driver,
        profileDir: tempDir,
        firefoxExtensionWarmup: { mode: 'selenium-managed' },
        config: {
          expectedExtensionId: 'monitor-bloqueos@openpath',
          blockedPageUnblockRequestDomain: 'blocked.example.test',
          blockedPageUnblockRequestTimeoutMs: 100,
          useLocalFirefoxAddon: false,
          useSeleniumFirefox: true,
        },
      });

      assert.equal(evidence.success, true);
      assert.equal(evidence.submitClicked, true);
      assert.equal(evidence.submitClickStale, true);
      assert.deepEqual(
        driver.calls.filter((call: string) => call.startsWith('submit')),
        ['submit-stale']
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('collects allowlisted external navigation evidence from browser state', async () => {
    const driver = createDriver({
      page: {
        href: 'https://www.example.com/',
        title: 'Example Domain',
        readyState: 'complete',
        blockedByOpenPath: false,
        metrics: { duration: 12 },
        resourceHosts: ['www.example.com'],
      },
    });

    const evidence = await collectAllowlistedExternalNavigationDiagnostics({
      driver,
      url: 'https://example.com/',
      expectedHosts: ['example.com'],
      timeoutMs: 100,
    });

    assert.equal(evidence.success, true);
    assert.equal(evidence.finalHost, 'www.example.com');
    assert.equal(evidence.hostAllowed, true);
    assert.deepEqual(evidence.resourceHosts, ['www.example.com']);
  });

  test('models Reddit navigation off, diagnostic success, and gate failure modes', async () => {
    assert.deepEqual(buildRedditNavigationSkippedEvidence('off', { firstPass: { ok: true } }), {
      mode: 'off',
      url: 'https://www.reddit.com/',
      success: null,
      blockedByOpenPath: false,
      timedOut: false,
      metrics: null,
      resourceHosts: [],
      errors: [],
      firstPass: { ok: true },
      secondPass: null,
    });

    const successDriver = createDriver({
      page: {
        href: 'https://www.reddit.com/',
        title: 'Reddit',
        readyState: 'complete',
        blockedByOpenPath: false,
        metrics: { duration: 20 },
        resourceHosts: ['www.redditstatic.com'],
      },
    });
    const diagnostic = await collectRedditRealNavigationDiagnostics({
      driver: successDriver,
      mode: 'diagnostic',
      timeoutMs: 100,
    });
    assert.equal(diagnostic.success, true);
    assert.deepEqual(diagnostic.resourceHosts, ['www.redditstatic.com']);

    const blockedDriver = createDriver({
      page: {
        href: 'https://www.reddit.com/',
        title: 'OpenPath blocked',
        readyState: 'complete',
        blockedByOpenPath: true,
        metrics: null,
        resourceHosts: [],
      },
    });
    const gate = await collectRedditRealNavigationDiagnostics({
      driver: blockedDriver,
      mode: 'gate',
      timeoutMs: 100,
    });
    assert.equal(gate.success, false);
    assert.equal(gate.blockedByOpenPath, true);
  });

  test('builds skipped blocked-page evidence with stable artifact fields', () => {
    const evidence = buildBlockedPageUnblockRequestSkippedEvidence('driver unavailable', {
      useLocalFirefoxAddon: false,
      useSeleniumFirefox: true,
      blockedPageUnblockRequestDomain: 'blocked.example.test',
    });

    assert.equal(evidence.success, false);
    assert.equal(evidence.skipped, true);
    assert.equal(evidence.permissionsMonkeypatch, false);
    assert.equal(evidence.blockedPageDomain, 'blocked.example.test');
    assert.equal(evidence.userInputHandlerError, false);
  });
});
