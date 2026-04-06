import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it } from 'node:test';

import {
  appendTestEmailSinkEntry,
  clearTestEmailSink,
  DEFAULT_TEST_EMAIL_SINK_FILE,
  resolveTestEmailSinkFile,
} from '../src/lib/test-email-sink.js';

const originalSinkFile = process.env.CP_TEST_EMAIL_SINK_FILE;

afterEach(() => {
  if (originalSinkFile === undefined) {
    delete process.env.CP_TEST_EMAIL_SINK_FILE;
  } else {
    process.env.CP_TEST_EMAIL_SINK_FILE = originalSinkFile;
  }
});

describe('test-email-sink', () => {
  it('uses the default sink path when no override is configured', () => {
    delete process.env.CP_TEST_EMAIL_SINK_FILE;
    assert.equal(resolveTestEmailSinkFile(), DEFAULT_TEST_EMAIL_SINK_FILE);
  });

  it('appends entries and clears the configured sink file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cp-test-email-sink-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    try {
      await appendTestEmailSinkEntry({
        to: 'teacher@example.com',
        subject: 'Invite',
        html: '<p>Hello</p>',
        text: 'Hello',
        createdAt: '2026-04-06T10:00:00.000Z',
      });

      const body = await readFile(sinkFile, 'utf8');
      const entries = body
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      assert.equal(entries.length, 1);
      assert.equal(entries[0].to, 'teacher@example.com');
      assert.equal(entries[0].subject, 'Invite');

      await clearTestEmailSink();

      await assert.rejects(() => readFile(sinkFile, 'utf8'), { code: 'ENOENT' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
