import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  fetchWithConnectionRetry,
  isTransientFetchError,
  isTransientGitHubCliError,
} from '../scripts/lib/network-retry.mjs';

function fetchError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('network-retry', () => {
  const originalFetch = globalThis.fetch;
  const originalDelay = process.env.CLASSROOMPATH_NETWORK_RETRY_DELAY_MS;
  const originalWrite = process.stderr.write;

  beforeEach(() => {
    process.env.CLASSROOMPATH_NETWORK_RETRY_DELAY_MS = '1';
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalWrite;
    if (originalDelay === undefined) {
      delete process.env.CLASSROOMPATH_NETWORK_RETRY_DELAY_MS;
    } else {
      process.env.CLASSROOMPATH_NETWORK_RETRY_DELAY_MS = originalDelay;
    }
  });

  test('retries fetch on ENOTFOUND then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) {
        throw fetchError('ENOTFOUND');
      }
      return new Response('ok');
    }) as typeof fetch;

    const response = await fetchWithConnectionRetry('https://example.test/');
    assert.equal(await response.text(), 'ok');
    assert.equal(calls, 3);
  });

  test('returns an HTTP 500 response without retrying', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('boom', { status: 500 });
    }) as typeof fetch;

    const response = await fetchWithConnectionRetry('https://example.test/');
    assert.equal(response.status, 500);
    assert.equal(calls, 1);
  });

  test('does not retry ECONNRESET on POST but does on GET', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw fetchError('ECONNRESET');
    }) as typeof fetch;

    await assert.rejects(
      fetchWithConnectionRetry('https://example.test/', { method: 'POST' }),
      /fetch failed/
    );
    assert.equal(calls, 1);

    assert.equal(isTransientFetchError(fetchError('ECONNRESET'), 'GET'), true);
    assert.equal(isTransientFetchError(fetchError('UND_ERR_SOCKET'), 'HEAD'), true);
    assert.equal(isTransientFetchError(fetchError('ECONNRESET'), 'POST'), false);
    assert.equal(isTransientFetchError(fetchError('ETIMEDOUT'), 'POST'), true);
    assert.equal(isTransientFetchError(fetchError('ENETUNREACH'), 'POST'), true);
    assert.equal(isTransientFetchError(fetchError('EPERM'), 'GET'), false);
    assert.equal(isTransientFetchError(new Error('fetch failed'), 'GET'), false);
  });

  test('gives up after 4 attempts and rethrows the last error', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw fetchError('EAI_AGAIN');
    }) as typeof fetch;

    await assert.rejects(fetchWithConnectionRetry('https://example.test/'), /fetch failed/);
    assert.equal(calls, 4);
  });

  test('classifies gh stderr', () => {
    assert.equal(isTransientGitHubCliError('error connecting to api.github.com'), true);
    assert.equal(isTransientGitHubCliError('dial tcp 1.2.3.4:443: i/o timeout'), true);
    assert.equal(isTransientGitHubCliError('HTTP 404: Not Found'), false);
    assert.equal(isTransientGitHubCliError(''), false);
  });
});
