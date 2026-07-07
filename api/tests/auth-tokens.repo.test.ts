import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema, pushSubscriptions } from '../src/db/openpath.js';
import {
  deletePasswordResetTokensByUserId,
  replaceEmailVerificationToken,
  replacePasswordResetToken,
} from '../src/db/openpath-repos/auth-tokens.repo.js';
import {
  deleteSubscriptionOwnedBy,
  replaceSubscriptionByEndpoint,
} from '../src/db/openpath-repos/push-subscriptions.repo.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const USER_ID = `tokrepo_${RUN_ID}`;
const ENDPOINT = `https://push.repo-test/${RUN_ID}`;

// password_reset_tokens/email_verification_tokens/push_subscriptions all carry
// a DB-level FK on user_id -> users.id (not modeled in the Drizzle schema in
// db/openpath.ts, but enforced by the migration). Seed a real user row so the
// inserts under test satisfy that constraint, same convention as
// roles.repo.test.ts's seedUser helper.
before(async () => {
  await openpathDb.insert(openpathSchema.users).values({
    id: USER_ID,
    email: `${USER_ID}@test.local`,
    name: 'Auth Tokens Repo Test User',
    passwordHash: 'hashed',
    isActive: true,
    emailVerified: true,
  });
});

after(async () => {
  await openpathDb
    .delete(openpathSchema.passwordResetTokens)
    .where(eq(openpathSchema.passwordResetTokens.userId, USER_ID));
  await openpathDb
    .delete(openpathSchema.emailVerificationTokens)
    .where(eq(openpathSchema.emailVerificationTokens.userId, USER_ID));
  await openpathDb
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.id, [`push_${RUN_ID}_a`, `push_${RUN_ID}_b`]));
  await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
});

describe('auth-tokens.repo + push-subscriptions.repo', () => {
  it('replacePasswordResetToken keeps at most one token per user; compensation delete clears it', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await replacePasswordResetToken(USER_ID, {
      id: `reset_${RUN_ID}_1`,
      tokenHash: 'h1',
      expiresAt,
    });
    await replacePasswordResetToken(USER_ID, {
      id: `reset_${RUN_ID}_2`,
      tokenHash: 'h2',
      expiresAt,
    });

    const rows = await openpathDb
      .select()
      .from(openpathSchema.passwordResetTokens)
      .where(eq(openpathSchema.passwordResetTokens.userId, USER_ID));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, `reset_${RUN_ID}_2`);

    await deletePasswordResetTokensByUserId(USER_ID);
    const afterDelete = await openpathDb
      .select()
      .from(openpathSchema.passwordResetTokens)
      .where(eq(openpathSchema.passwordResetTokens.userId, USER_ID));
    assert.equal(afterDelete.length, 0);
  });

  it('replaceEmailVerificationToken keeps at most one token per user', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await replaceEmailVerificationToken(USER_ID, {
      id: `verify_${RUN_ID}_1`,
      tokenHash: 'h1',
      expiresAt,
    });
    await replaceEmailVerificationToken(USER_ID, {
      id: `verify_${RUN_ID}_2`,
      tokenHash: 'h2',
      expiresAt,
    });

    const rows = await openpathDb
      .select()
      .from(openpathSchema.emailVerificationTokens)
      .where(eq(openpathSchema.emailVerificationTokens.userId, USER_ID));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, `verify_${RUN_ID}_2`);
  });

  it('replaceSubscriptionByEndpoint dedupes on endpoint; owner-scoped delete ignores other users', async () => {
    await replaceSubscriptionByEndpoint({
      id: `push_${RUN_ID}_a`,
      userId: USER_ID,
      groupIds: ['g1'],
      endpoint: ENDPOINT,
      p256dh: 'k1',
      auth: 'a1',
      userAgent: '',
    });
    await replaceSubscriptionByEndpoint({
      id: `push_${RUN_ID}_b`,
      userId: USER_ID,
      groupIds: ['g1'],
      endpoint: ENDPOINT,
      p256dh: 'k2',
      auth: 'a2',
      userAgent: '',
    });

    const rows = await openpathDb
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, ENDPOINT));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, `push_${RUN_ID}_b`);

    const wrongOwner = await deleteSubscriptionOwnedBy({
      userId: 'someone-else',
      endpoint: ENDPOINT,
    });
    assert.equal(wrongOwner.length, 0, 'owner scoping must hold');

    const rightOwner = await deleteSubscriptionOwnedBy({ userId: USER_ID, endpoint: ENDPOINT });
    assert.deepEqual(rightOwner, [{ id: `push_${RUN_ID}_b` }]);
  });
});
