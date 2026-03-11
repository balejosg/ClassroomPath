import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import bcrypt from 'bcrypt';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  deliverEmailVerification,
  issueEmailVerificationDelivery,
  issueOpenPathEmailVerificationToken,
} from '../src/trpc/routers/auth-email-delivery.js';
import { withTestDbLock } from './test-utils.js';

const originalFetch = globalThis.fetch;
const originalPublicUrl = process.env.PUBLIC_URL;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const RUN_ID = Date.now().toString(36);
const seededUserIds = new Set<string>();
let userCounter = 0;

function nextUserId(label: string): string {
  userCounter += 1;
  return `email-verify-${RUN_ID}-${label}-${userCounter}`;
}

async function seedOpenPathUser(params: { userId: string; email: string; name: string }) {
  seededUserIds.add(params.userId);

  await openpathDb.insert(openpathSchema.users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed_password_placeholder',
    isActive: true,
    emailVerified: false,
  });
}

afterEach(async () => {
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

  const userIds = [...seededUserIds];
  seededUserIds.clear();

  if (userIds.length === 0) {
    return;
  }

  await withTestDbLock(async () => {
    await openpathDb
      .delete(openpathSchema.emailVerificationTokens)
      .where(inArray(openpathSchema.emailVerificationTokens.userId, userIds));
    await openpathDb.delete(openpathSchema.users).where(inArray(openpathSchema.users.id, userIds));
  });
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

  it('issues a new verification token and replaces any previous token for the user', async () => {
    const userId = nextUserId('replace');

    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'Replace Token User',
      });

      const firstIssue = await issueOpenPathEmailVerificationToken(userId);
      const firstRows = await openpathDb
        .select()
        .from(openpathSchema.emailVerificationTokens)
        .where(eq(openpathSchema.emailVerificationTokens.userId, userId));

      assert.equal(firstRows.length, 1);
      assert.equal(firstIssue.verificationToken.length, 12);
      assert.equal(
        await bcrypt.compare(firstIssue.verificationToken, firstRows[0].tokenHash),
        true
      );

      const secondIssue = await issueOpenPathEmailVerificationToken(userId);
      const secondRows = await openpathDb
        .select()
        .from(openpathSchema.emailVerificationTokens)
        .where(eq(openpathSchema.emailVerificationTokens.userId, userId));

      assert.equal(secondRows.length, 1);
      assert.notEqual(secondIssue.verificationToken, firstIssue.verificationToken);
      assert.equal(
        await bcrypt.compare(secondIssue.verificationToken, secondRows[0].tokenHash),
        true
      );
      assert.equal(
        await bcrypt.compare(firstIssue.verificationToken, secondRows[0].tokenHash),
        false
      );
      assert.equal(secondRows[0].expiresAt.toISOString(), secondIssue.verificationExpiresAt);
    });
  });

  it('issues and delivers a verification token internally when the provider is disabled', async () => {
    process.env.PUBLIC_URL = 'https://classroompath.test';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const userId = nextUserId('internal');
    const { result, storedTokenHash, storedExpiresAt } = await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'Internal Delivery User',
      });

      const result = await issueEmailVerificationDelivery({
        userId,
        email: `${userId}@example.com`,
        name: 'Internal Delivery User',
      });

      const rows = await openpathDb
        .select()
        .from(openpathSchema.emailVerificationTokens)
        .where(eq(openpathSchema.emailVerificationTokens.userId, userId));

      assert.equal(rows.length, 1);

      return {
        result,
        storedTokenHash: rows[0].tokenHash,
        storedExpiresAt: rows[0].expiresAt.toISOString(),
      };
    });

    const verificationUrl = new URL(result.verificationUrl);
    const issuedToken = verificationUrl.searchParams.get('token');

    assert.equal(result.emailSent, false);
    assert.equal(result.verificationRequired, true);
    assert.equal(verificationUrl.origin, 'https://classroompath.test');
    assert.equal(verificationUrl.pathname, '/login');
    assert.equal(verificationUrl.searchParams.get('email'), `${userId}@example.com`);
    assert.ok(issuedToken);
    assert.equal(await bcrypt.compare(issuedToken!, storedTokenHash), true);
    assert.equal(result.verificationExpiresAt, storedExpiresAt);
  });
});
