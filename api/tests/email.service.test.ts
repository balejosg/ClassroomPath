import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { sendTransactionalEmail } from '../src/services/email.service.js';

const originalFetch = globalThis.fetch;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

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
