import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { inArray } from 'drizzle-orm';
import * as onboardingService from '../src/services/onboarding.service.js';
import { withTestDbLock } from './test-utils.js';

const RUN_ID = Date.now().toString(36);
let userCounter = 0;
const trackedUserIds = new Set<string>();

function nextUserId(label: string): string {
  userCounter += 1;
  return `test-user-${RUN_ID}-${label}-${String(userCounter)}`;
}

async function seedOpenPathUser(params: {
  userId: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}) {
  trackedUserIds.add(params.userId);
  await openpathDb.insert(openpathSchema.users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed_password_placeholder',
    isActive: true,
    emailVerified: params.emailVerified ?? true,
  });
}

describe('Onboarding Service', () => {
  after(async () => {
    const userIds = [...trackedUserIds];

    if (userIds.length > 0) {
      await db
        .delete(schema.cpMutationOperations)
        .where(inArray(schema.cpMutationOperations.userId, userIds));
      await db.delete(schema.cpMemberships).where(inArray(schema.cpMemberships.userId, userIds));
      await db.delete(schema.cpUserStatus).where(inArray(schema.cpUserStatus.userId, userIds));
      await openpathDb
        .delete(openpathSchema.roles)
        .where(inArray(openpathSchema.roles.userId, userIds));
      await openpathDb
        .delete(openpathSchema.users)
        .where(inArray(openpathSchema.users.id, userIds));
    }
  });

  it('should return no membership for new user', async () => {
    const userId = nextUserId('new');
    trackedUserIds.add(userId);
    const status = await withTestDbLock(() => onboardingService.getOnboardingStatus(userId));

    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, false);
    assert.strictEqual(status.organization, null);
  });

  it('should set waiting status', async () => {
    const waitingUserId = nextUserId('waiting');
    trackedUserIds.add(waitingUserId);

    await withTestDbLock(async () => {
      await onboardingService.setWaitingStatus(waitingUserId);

      const status = await onboardingService.getOnboardingStatus(waitingUserId);
      assert.strictEqual(status.hasMembership, false);
      assert.strictEqual(status.isWaiting, true);
    });
  });

  it('should clear waiting status', async () => {
    const waitingUserId = nextUserId('clear');
    trackedUserIds.add(waitingUserId);

    await withTestDbLock(async () => {
      await onboardingService.setWaitingStatus(waitingUserId);
      await onboardingService.clearWaitingStatus(waitingUserId);

      const status = await onboardingService.getOnboardingStatus(waitingUserId);
      assert.strictEqual(status.isWaiting, false);
    });
  });

  it('blocks onboarding for unverified users', async () => {
    const unverifiedUserId = nextUserId('unverified');
    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId: unverifiedUserId,
        email: `${unverifiedUserId}@example.com`,
        name: 'Unverified User',
        emailVerified: false,
      });

      await assert.rejects(
        onboardingService.assertCanStartOnboarding(unverifiedUserId),
        /verification required/i
      );
    });
  });
});
