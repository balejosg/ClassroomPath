import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  assertCanStartOnboarding,
  getOnboardingStatus,
} from '../src/services/onboarding-status.service.js';
import { setWaitingStatus } from '../src/services/waiting-status.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const USER_ID = `onboarding_status_user_${RUN_ID}`;

describe('onboarding-status.service', () => {
  before(async () => {
    await acquireTestDbLock();
    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, USER_ID));
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, USER_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
  });

  after(async () => {
    try {
      await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, USER_ID));
      await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, USER_ID));
      await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('reports waiting users without memberships and blocks unverified onboarding', async () => {
    await openpathDb.insert(openpathSchema.users).values({
      id: USER_ID,
      email: `onboarding-status-${RUN_ID}@example.com`,
      name: 'Onboarding Status User',
      passwordHash: 'hashed-password',
      isActive: true,
      emailVerified: false,
    });

    await setWaitingStatus(USER_ID);

    const status = await getOnboardingStatus(USER_ID);
    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, true);
    assert.strictEqual(status.organization, null);

    await assert.rejects(
      () => assertCanStartOnboarding(USER_ID),
      /Email verification required before onboarding/
    );
  });
});
