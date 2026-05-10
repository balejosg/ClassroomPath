import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildAjaxAutoAllowCanaryPage,
  buildCompletedProbesFromHits,
  createAjaxAutoAllowCanaryServer,
  createAjaxAutoAllowCanaryState,
  openUrlWithTransientBrowserRetry,
  waitForAjaxAutoAllowPageObserver,
} from '../scripts/lib/ajax-auto-allow-canary-harness.mjs';
import {
  createAjaxAutoAllowCanaryRuntimeServer,
  emitAjaxAutoAllowCanaryRuntimeSummary,
  listenAjaxAutoAllowCanaryRuntimeServer,
} from '../scripts/lib/ajax-auto-allow-canary-runtime.mjs';

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

const redditDiagnosticProbes = Object.freeze([
  {
    id: 'reddit-static-script',
    kind: 'script',
    host: 'www.redditstatic.com',
    url: 'https://www.redditstatic.com/reddit-static-diagnostic.js',
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

  test('page generation can include Reddit-style diagnostic probes', () => {
    const page = buildAjaxAutoAllowCanaryPage({
      platform: 'Windows',
      probes,
      redditDiagnosticProbes,
      originHost: 'ajax-origin.127.0.0.1.sslip.io',
      port: 18088,
      timeoutMs: 90000,
      probeTimeoutMs: 4000,
      redditDiagnosticTimeoutMs: 1500,
      stateGlobalName: '__openpathWindowsAjaxCanaryState',
      statusElement: true,
    });

    assert.match(page, /redditDiagnosticProbes/);
    assert.match(page, /completedRedditDiagnosticEvents/);
    assert.match(page, /matchedRedditProbeId/);
    assert.match(page, /runRedditDiagnosticProbes/);
    assert.match(page, /redditDiagnostics/);
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

  test('server merges redacted attempt diagnostics and caps attempt evidence', async () => {
    const state = createAjaxAutoAllowCanaryState(probes, { redditDiagnosticProbes });
    let resultPayload: unknown = null;
    const server = createAjaxAutoAllowCanaryServer({
      platform: 'test',
      probes,
      originHost: 'ajax-origin.127.0.0.1.sslip.io',
      port: 18092,
      state,
      buildPage: () => '<!doctype html><p>ok</p>',
      maxAttempts: 1,
      redact: (value) => JSON.parse(JSON.stringify(value).replace(/secret-token/g, '[redacted]')),
      onResult: (payload) => {
        resultPayload = payload;
      },
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(18092, '127.0.0.1', resolve);
    });
    try {
      await fetch('http://ajax-origin.127.0.0.1.sslip.io:18092/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt: { attempt: 1, token: 'secret-token' },
          completedRedditDiagnosticEvents: { 'reddit-static-script': true },
        }),
      });
      await fetch('http://ajax-origin.127.0.0.1.sslip.io:18092/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt: { attempt: 2 } }),
      });
      await fetch('http://ajax-origin.127.0.0.1.sslip.io:18092/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, token: 'secret-token' }),
      });

      assert.deepEqual(state.completedRedditDiagnosticEvents, {
        'reddit-static-script': true,
      });
      assert.equal(state.browserAttempts.length, 1);
      assert.deepEqual(state.browserAttempts[0], { attempt: 2 });
      assert.deepEqual(resultPayload, { success: true, token: '[redacted]' });
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

  test('runtime server lifecycle delegates page and result behavior through a platform adapter', async () => {
    let resultPayload: unknown = null;
    const { state, server } = createAjaxAutoAllowCanaryRuntimeServer({
      platformAdapter: {
        label: 'Adapter',
        probes,
        originHost: 'ajax-origin.127.0.0.1.sslip.io',
        stateGlobalName: '__openpathAdapterAjaxCanaryState',
        scriptGlobalName: '__openpathAdapterAjaxScriptProbe',
        stylesheetCss: 'body { --adapter-probe: loaded; }',
      },
      port: 18093,
      timeoutMs: 90000,
      probeTimeoutMs: 4000,
      onResult: (payload) => {
        resultPayload = payload;
      },
    });

    await listenAjaxAutoAllowCanaryRuntimeServer(server, { port: 18093, host: '127.0.0.1' });
    try {
      const page = await fetch('http://ajax-origin.127.0.0.1.sslip.io:18093/').then((response) =>
        response.text()
      );
      assert.match(page, /Adapter AJAX Auto-Allow Canary/);
      assert.match(page, /__openpathAdapterAjaxCanaryState/);

      await fetch('http://ajax-origin.127.0.0.1.sslip.io:18093/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, custom: 'adapter-result' }),
      });

      assert.equal(state.originPageHits, 1);
      assert.deepEqual(resultPayload, { success: true, custom: 'adapter-result' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('runtime summary emission preserves artifact, progress, log, and boundary outputs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ajax-runtime-summary-'));
    const artifactPath = join(tempDir, 'summary.json');
    const progressEvents: unknown[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const githubOutputs: [string, string][] = [];
    const summary = {
      success: false,
      failureBoundary: {
        id: 'explicit-probe-traffic',
        message: 'Explicit probe traffic did not converge.',
      },
    };

    try {
      await emitAjaxAutoAllowCanaryRuntimeSummary({
        summary,
        artifactPath,
        summaryPrefix: 'ADAPTER_AJAX_SUMMARY',
        resultOutputKey: 'adapter_ajax_result',
        failureBoundaryOutputs: true,
        progress: (phase, status, details) => {
          progressEvents.push({ phase, status, ...details });
        },
        output: {
          log: (line) => logs.push(line),
          error: (line) => errors.push(line),
        },
        githubOutput: (key, value) => {
          githubOutputs.push([key, value]);
        },
      });

      assert.deepEqual(JSON.parse(await readFile(artifactPath, 'utf8')), summary);
      assert.deepEqual(progressEvents, [
        {
          phase: 'artifact-written',
          status: 'failed',
          boundaryId: 'explicit-probe-traffic',
          message: 'Explicit probe traffic did not converge.',
        },
      ]);
      assert.deepEqual(logs, []);
      assert.deepEqual(errors, [`ADAPTER_AJAX_SUMMARY ${JSON.stringify(summary)}`]);
      assert.deepEqual(githubOutputs, [
        ['adapter_ajax_result', 'failure'],
        ['failure_boundary_id', 'explicit-probe-traffic'],
        ['failure_boundary_message', 'Explicit probe traffic did not converge.'],
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
