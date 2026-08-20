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

function createDriver({ page, statusText = '', browserLogs = [], navigationError = null } = {}) {
  const calls: string[] = [];
  const scriptCalls: string[] = [];
  const statusElement = {
    getText: async () => statusText,
  };
  const elements = {
    'request-reason': {
      clear: async () => calls.push('clear-reason'),
      sendKeys: async () => calls.push('send-reason'),
    },
    'submit-unblock-request': {
      click: async () => calls.push('submit'),
    },
    'request-status': statusElement,
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
    scriptCalls,
    executeScript: async (script: string) => {
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
    executeAsyncScript: async () => ({ success: true }),
    findElement: async (locator: { value?: string }) => {
      const rawValue = String(locator.value ?? '');
      const id = rawValue.match(/\[id="([^"]+)"\]/)?.[1] ?? rawValue;
      return elements[id];
    },
    wait: async (predicate: () => Promise<unknown>) => predicate(),
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
      assert.match(driver.scriptCalls.join('\n'), /status \? \(status\.textContent \|\| ''\) : ''/);
      assert.match(driver.scriptCalls.join('\n'), /status \? \(status\.className \|\| ''\) : ''/);
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
