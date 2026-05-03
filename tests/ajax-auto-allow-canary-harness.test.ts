import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildAjaxAutoAllowCanaryPage,
  buildCompletedProbesFromHits,
  createAjaxAutoAllowCanaryServer,
  createAjaxAutoAllowCanaryState,
  openUrlWithTransientBrowserRetry,
  waitForAjaxAutoAllowPageObserver,
} from '../scripts/lib/ajax-auto-allow-canary-harness.mjs';

const probes = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: 'ajax-target.127.0.0.1.sslip.io',
    path: '/data.json',
    expectedWhitelistHost: 'ajax-target.127.0.0.1.sslip.io',
  },
  {
    id: 'font-subresource',
    kind: 'font',
    host: 'ajax-font.127.0.0.1.sslip.io',
    path: '/font.woff2',
    expectedWhitelistHost: 'ajax-font.127.0.0.1.sslip.io',
  },
  {
    id: 'stylesheet-font-subresource',
    kind: 'stylesheet-font',
    host: 'ajax-font-chain.127.0.0.1.sslip.io',
    path: '/font-from-stylesheet.woff2',
    stylesheetHost: 'ajax-style.127.0.0.1.sslip.io',
    stylesheetPath: '/font-chain.css',
    expectedWhitelistHost: 'ajax-font-chain.127.0.0.1.sslip.io',
    expectsPageResourceCandidate: false,
  },
]);

describe('shared AJAX auto-allow canary harness', () => {
  test('page generation includes all probe kinds and observer event capture', () => {
    const page = buildAjaxAutoAllowCanaryPage({
      platform: 'test',
      probes,
      originHost: 'ajax-origin.127.0.0.1.sslip.io',
      port: 18088,
      timeoutMs: 90000,
      probeTimeoutMs: 4000,
      stateGlobalName: '__openpathTestAjaxCanaryState',
      statusElement: true,
    });

    assert.match(page, /openpath-page-resource-candidate/);
    assert.match(page, /__openpathPageResourceObserverInstalled/);
    assert.match(page, /stylesheet-font-subresource/);
    assert.match(page, /font\/woff2/);
    assert.match(page, /\/attempt/);
    assert.match(page, /\/probe-state\?probe=/);
  });

  test('probe completion is derived from server traffic hits', async () => {
    const state = createAjaxAutoAllowCanaryState(probes);
    const server = createAjaxAutoAllowCanaryServer({
      platform: 'test',
      probes,
      originHost: 'ajax-origin.127.0.0.1.sslip.io',
      port: 18091,
      state,
      buildPage: () => '<!doctype html><p>ok</p>',
      scriptGlobalName: '__openpathTestAjaxScriptProbe',
      stylesheetCss: 'body { --probe: loaded; }',
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(18091, '127.0.0.1', resolve);
    });
    try {
      const response = await fetch('http://ajax-font.127.0.0.1.sslip.io:18091/font.woff2');
      assert.equal(response.status, 200);
      assert.deepEqual(buildCompletedProbesFromHits(probes, state.probeHits), {
        'ajax-fetch': false,
        'font-subresource': true,
        'stylesheet-font-subresource': false,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('page observer wait reloads until observer is installed', async () => {
    const calls: string[] = [];
    const driver = {
      async get(url: string) {
        calls.push(url);
      },
      async executeScript() {
        return { openpathObserverInstalled: calls.length >= 2 };
      },
    };

    const diagnostics = await waitForAjaxAutoAllowPageObserver({
      driver,
      originUrl: 'http://ajax-origin.127.0.0.1.sslip.io:18088/',
      timeoutMs: 2000,
      reloadEveryMs: 10,
      pollMs: 1,
      collectBrowserNavigationDiagnostics: async (candidateDriver) =>
        candidateDriver.executeScript('return {};'),
    });

    assert.equal(diagnostics.openpathObserverInstalled, true);
    assert.equal(calls.length, 2);
  });

  test('browser open retries a discarded Marionette context with a fresh session', async () => {
    const events: string[] = [];
    let launches = 0;

    const result = await openUrlWithTransientBrowserRetry({
      url: 'http://ajax-origin.127.0.0.1.sslip.io:18088/',
      maxAttempts: 2,
      createSession: async () => {
        launches += 1;
        const id = launches;
        return {
          id,
          async get(url: string) {
            events.push(`get:${id}:${url}`);
            if (id === 1) {
              throw new Error('Browsing context has been discarded');
            }
          },
          async quit() {
            events.push(`quit:${id}`);
          },
        };
      },
      closeSession: async (session) => {
        await session.quit();
      },
    });

    assert.equal(result.opened, true);
    assert.equal(result.attempt, 2);
    assert.equal(result.session.id, 2);
    assert.deepEqual(events, [
      'get:1:http://ajax-origin.127.0.0.1.sslip.io:18088/',
      'quit:1',
      'get:2:http://ajax-origin.127.0.0.1.sslip.io:18088/',
    ]);
  });

  test('browser open can use a custom opener for wrapped Selenium sessions', async () => {
    const events: string[] = [];
    const driver = {
      async get(url: string) {
        events.push(`driver-get:${url}`);
      },
    };

    const result = await openUrlWithTransientBrowserRetry({
      url: 'http://ajax-origin.127.0.0.1.sslip.io:18088/',
      createSession: async () => ({ driver }),
      openSessionUrl: async (session, url) => {
        await session.driver.get(url);
      },
    });

    assert.equal(result.opened, true);
    assert.deepEqual(events, ['driver-get:http://ajax-origin.127.0.0.1.sslip.io:18088/']);
  });
});
