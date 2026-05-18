import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it } from 'node:test';

import { sendTransactionalEmail } from '../src/services/email.service.js';

const originalFetch = globalThis.fetch;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalMockEmailDelivery = process.env.CP_FAKE_EMAIL_DELIVERY;
const originalEmailSinkFile = process.env.CP_TEST_EMAIL_SINK_FILE;

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalResendApiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = originalResendApiKey;
  }

  if (originalResendFromEmail === undefined) {
    delete process.env.RESEND_FROM_EMAIL;
  } else {
    process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
  }

  if (originalMockEmailDelivery === undefined) {
    delete process.env.CP_FAKE_EMAIL_DELIVERY;
  } else {
    process.env.CP_FAKE_EMAIL_DELIVERY = originalMockEmailDelivery;
  }

  if (originalEmailSinkFile === undefined) {
    delete process.env.CP_TEST_EMAIL_SINK_FILE;
  } else {
    process.env.CP_TEST_EMAIL_SINK_FILE = originalEmailSinkFile;
  }
});

describe('email.service', () => {
  it('returns disabled delivery when Resend credentials are missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: 'teacher@example.com',
      subject: 'Invite',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    assert.deepStrictEqual(result, { sent: false, provider: 'disabled' });
    assert.strictEqual(fetchCalled, false);
  });

  it('returns a successful mock delivery when test delivery is enabled', async () => {
    process.env.CP_FAKE_EMAIL_DELIVERY = '1';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: 'teacher@example.com',
      subject: 'Invite',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    assert.deepStrictEqual(result, { sent: true, provider: 'mock', id: 'mock-email' });
    assert.strictEqual(fetchCalled, false);
  });

  it('writes mock deliveries to the local sink when configured', async () => {
    process.env.CP_FAKE_EMAIL_DELIVERY = '1';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const tempDir = await mkdtemp(join(tmpdir(), 'cp-email-sink-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    try {
      const result = await sendTransactionalEmail({
        to: 'teacher@example.com',
        subject: 'Invite',
        html: '<p>Hello <a href="https://classroompath.test/login?token=abc">verify</a></p>',
        text: 'Hello',
      });

      assert.deepStrictEqual(result, { sent: true, provider: 'mock', id: 'mock-email' });

      const sinkBody = await readFile(sinkFile, 'utf8');
      const entries = sinkBody
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].to, 'teacher@example.com');
      assert.strictEqual(entries[0].subject, 'Invite');
      assert.strictEqual(typeof entries[0].createdAt, 'string');
      assert.match(String(entries[0].html), /token=abc/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('routes reserved test recipients to the local sink even when Resend is configured', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';
    delete process.env.CP_FAKE_EMAIL_DELIVERY;

    const tempDir = await mkdtemp(join(tmpdir(), 'cp-email-sink-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called for reserved test recipients');
    }) as typeof fetch;

    try {
      const result = await sendTransactionalEmail({
        to: 'release-gate-123@test.local',
        subject: 'Verification',
        html: '<p><a href="http://staging-host.example.invalid:3000/login?token=abc">verify</a></p>',
        text: 'Verify',
      });

      assert.deepStrictEqual(result, { sent: true, provider: 'mock', id: 'mock-email' });
      assert.strictEqual(fetchCalled, false);

      const sinkBody = await readFile(sinkFile, 'utf8');
      const entries = sinkBody
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].to, 'release-gate-123@test.local');
      assert.strictEqual(entries[0].subject, 'Verification');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps delivery disabled for reserved test recipients when Resend credentials are missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.CP_FAKE_EMAIL_DELIVERY;

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called without Resend credentials');
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: 'release-gate-123@test.local',
      subject: 'Verification',
      html: '<p>Verify</p>',
      text: 'Verify',
    });

    assert.deepStrictEqual(result, { sent: false, provider: 'disabled' });
    assert.strictEqual(fetchCalled, false);
  });

  it('posts email payloads to Resend when configured', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';

    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      seenUrl = String(input);
      seenInit = init;

      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: 'teacher@example.com',
      subject: 'Invite',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    assert.strictEqual(seenUrl, 'https://api.resend.com/emails');
    assert.deepStrictEqual(result, {
      sent: true,
      provider: 'resend',
      id: 'email_123',
    });

    const headers = seenInit?.headers as Record<string, string>;
    assert.strictEqual(headers.Authorization, 'Bearer re_test_123');
    assert.strictEqual(headers['Content-Type'], 'application/json');

    assert.deepStrictEqual(JSON.parse(String(seenInit?.body)), {
      from: 'noreply@classroompath.test',
      to: ['teacher@example.com'],
      subject: 'Invite',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
  });
});
