import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    process.env.BASE_URL = 'https://staging.classroompath.example.invalid.test';
    const fetchMock = mock.fn(async () => ({ ok: true }) as Response);
    const execSyncMock = mock.method(commandRunner, 'execSync', () => Buffer.from(''));
    global.fetch = fetchMock as typeof fetch;

    await globalSetup({} as never);

    assert.strictEqual(fetchMock.mock.calls.length, 0);
    assert.strictEqual(execSyncMock.mock.calls.length, 0);
  });

  test('clears the local email sink before running local setup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cp-global-setup-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;
    await writeFile(sinkFile, '{"stale":true}\n', 'utf8');

    try {
      global.fetch = mock.fn(async () => ({ ok: true }) as Response) as typeof fetch;
      const execSyncMock = mock.method(commandRunner, 'execSync', () => Buffer.from(''));

      await globalSetup({} as never);

      await assert.rejects(
        () => import('node:fs/promises').then(({ readFile }) => readFile(sinkFile, 'utf8')),
        {
          code: 'ENOENT',
        }
      );
      assert.ok(execSyncMock.mock.calls.length > 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
