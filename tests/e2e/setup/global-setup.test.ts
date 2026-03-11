import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';

import globalSetup, { commandRunner } from './global-setup.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function restoreFetch() {
  if (ORIGINAL_FETCH) {
    global.fetch = ORIGINAL_FETCH;
  } else {
    delete global.fetch;
  }
}

describe('playwright global setup', () => {
  beforeEach(() => {
    mock.restoreAll();
    process.env = {
      ...ORIGINAL_ENV,
      BASE_URL: 'http://localhost:5173',
      OPENPATH_API_URL: 'http://127.0.0.1:3010',
      E2E_SETUP_HEALTHCHECK_ATTEMPTS: '1',
      E2E_SETUP_HEALTHCHECK_DELAY_MS: '0',
    };
    restoreFetch();
  });

  afterEach(() => {
    mock.restoreAll();
    process.env = { ...ORIGINAL_ENV };
    restoreFetch();
  });

  test('fails when the OpenPath API never becomes ready', async () => {
    global.fetch = mock.fn(async () => ({ ok: false }) as Response) as typeof fetch;

    await assert.rejects(
      globalSetup({} as never),
      /E2E global setup failed: OpenPath API not ready/i
    );
  });

  test('fails when the pre-seed truncate step errors', async () => {
    global.fetch = mock.fn(async () => ({ ok: true }) as Response) as typeof fetch;
    const execSyncMock = mock.method(commandRunner, 'execSync', () => Buffer.from(''));

    execSyncMock.mock.mockImplementationOnce(() => {
      throw new Error('truncate boom');
    });

    await assert.rejects(
      globalSetup({} as never),
      /E2E global setup failed: pre-seed truncate failed: truncate boom/i
    );
    assert.strictEqual(execSyncMock.mock.calls.length, 1);
  });

  test('skips local mutations for external BASE_URL values', async () => {
    process.env.BASE_URL = 'https://classroompath-staging.example.test';
    const fetchMock = mock.fn(async () => ({ ok: true }) as Response);
    const execSyncMock = mock.method(commandRunner, 'execSync', () => Buffer.from(''));
    global.fetch = fetchMock as typeof fetch;

    await globalSetup({} as never);

    assert.strictEqual(fetchMock.mock.calls.length, 0);
    assert.strictEqual(execSyncMock.mock.calls.length, 0);
  });
});
