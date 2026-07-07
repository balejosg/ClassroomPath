import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema, pushSubscriptions } from '../src/db/openpath.js';
import {
  deleteSubscriptionOwnedBy,
  replaceSubscriptionByEndpoint,
} from '../src/db/openpath-repos/push-subscriptions.repo.js';

// Self-contained 1:1 gate-named coverage for push-subscriptions.repo.ts. Pins
// the endpoint dedupe (delete-then-insert, no transaction, plan F13(c)) and the
// owner-scoped delete (userId supplied by the caller, never derived). The
// push_subscriptions table carries a DB-level FK on user_id -> users.id (not
// modeled in the Drizzle schema, enforced by the migration), so seed a real
// user row, same convention as auth-tokens.repo.test.ts.

const RUN_ID = Math.random().toString(36).slice(2, 10);
const USER_ID = `pushrepo_${RUN_ID}`;
const ENDPOINT = `https://push.repo-test/${RUN_ID}`;

before(async () => {
  await openpathDb.insert(openpathSchema.users).values({
    id: USER_ID,
    email: `${USER_ID}@test.local`,
    name: 'Push Subscriptions Repo Test User',
    passwordHash: 'hashed',
    isActive: true,
    emailVerified: true,
  });
});

after(async () => {
  await openpathDb
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.id, [`push_${RUN_ID}_a`, `push_${RUN_ID}_b`]));
  await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
});

describe('push-subscriptions.repo (1:1 named)', () => {
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
