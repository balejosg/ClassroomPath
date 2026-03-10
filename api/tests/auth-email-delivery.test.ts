import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { deliverEmailVerification } from '../src/trpc/routers/auth-email-delivery.js';

const originalFetch = globalThis.fetch;
const originalPublicUrl = process.env.PUBLIC_URL;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalPublicUrl === undefined) {
    delete process.env.PUBLIC_URL;
  } else {
    process.env.PUBLIC_URL = originalPublicUrl;
  }

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

describe('auth-email-delivery', () => {
  it('builds a verification URL and reports successful delivery when Resend accepts the request', async () => {
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const result = await deliverEmailVerification({
      email: 'teacher@example.com',
      name: 'Teacher Example',
      verificationToken: 'verify-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });

    assert.deepStrictEqual(result, {
      email: 'teacher@example.com',
      verificationRequired: true,
      emailSent: true,
      verificationUrl:
        'https://classroompath.test/login?email=teacher%40example.com&token=verify-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });
  });

  it('returns the manual verification URL when provider delivery fails', async () => {
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';

    globalThis.fetch = (async () =>
      new Response('upstream failure', {
        status: 500,
      })) as typeof fetch;

    const result = await deliverEmailVerification({
      email: 'teacher@example.com',
      name: 'Teacher Example',
      verificationToken: 'verify-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });

    assert.equal(result.emailSent, false);
    assert.match(result.verificationUrl, /verify-token/);
  });
});
