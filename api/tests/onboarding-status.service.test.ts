import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

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
const WAITING_INVITE_USER_ID = `onboarding_status_waiting_invite_${RUN_ID}`;
const TRANSFER_USER_ID = `onboarding_status_transfer_${RUN_ID}`;
const WAITING_INVITED_ORG_ID = `onboarding_status_waiting_invited_org_${RUN_ID}`;
const TRANSFER_INVITED_ORG_ID = `onboarding_status_transfer_invited_org_${RUN_ID}`;
const CURRENT_ORG_ID = `onboarding_status_current_org_${RUN_ID}`;
const INVITATION_IDS = [
  `onboarding_status_invitation_waiting_${RUN_ID}`,
  `onboarding_status_invitation_transfer_${RUN_ID}`,
];
const USER_IDS = [USER_ID, WAITING_INVITE_USER_ID, TRANSFER_USER_ID];
const ORGANIZATION_IDS = [WAITING_INVITED_ORG_ID, TRANSFER_INVITED_ORG_ID, CURRENT_ORG_ID];

describe('onboarding-status.service', () => {
  before(async () => {
    await acquireTestDbLock();
    await db.delete(schema.cpInvitations).where(inArray(schema.cpInvitations.id, INVITATION_IDS));
    await db.delete(schema.cpUserStatus).where(inArray(schema.cpUserStatus.userId, USER_IDS));
    await db.delete(schema.cpMemberships).where(inArray(schema.cpMemberships.userId, USER_IDS));
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, ORGANIZATION_IDS));
    await openpathDb.delete(openpathSchema.users).where(inArray(openpathSchema.users.id, USER_IDS));
  });

  after(async () => {
    try {
      await db.delete(schema.cpInvitations).where(inArray(schema.cpInvitations.id, INVITATION_IDS));
      await db.delete(schema.cpUserStatus).where(inArray(schema.cpUserStatus.userId, USER_IDS));
      await db.delete(schema.cpMemberships).where(inArray(schema.cpMemberships.userId, USER_IDS));
      await db
        .delete(schema.cpOrganizations)
        .where(inArray(schema.cpOrganizations.id, ORGANIZATION_IDS));
      await openpathDb
        .delete(openpathSchema.users)
        .where(inArray(openpathSchema.users.id, USER_IDS));
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

  it('surfaces a pending invitation for waiting users so login can resolve it without the waiting room', async () => {
    await openpathDb.insert(openpathSchema.users).values({
      id: WAITING_INVITE_USER_ID,
      email: `onboarding-status-invite-${RUN_ID}@example.com`,
      name: 'Pending Invitation User',
      passwordHash: 'hashed-password',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(schema.cpOrganizations).values({
      id: WAITING_INVITED_ORG_ID,
      name: `Invited Org ${RUN_ID}`,
      createdBy: WAITING_INVITE_USER_ID,
    });

    await db.insert(schema.cpInvitations).values({
      id: INVITATION_IDS[0],
      organizationId: WAITING_INVITED_ORG_ID,
      email: `onboarding-status-invite-${RUN_ID}@example.com`,
      name: 'Pending Invitation User',
      role: 'teacher',
      tokenHash: `waiting${RUN_ID}`.padEnd(64, 'a'),
      invitedBy: WAITING_INVITE_USER_ID,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    await setWaitingStatus(WAITING_INVITE_USER_ID);

    const status = await getOnboardingStatus(WAITING_INVITE_USER_ID);
    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, true);
    assert.strictEqual(status.organization, null);
    assert.strictEqual(status.pendingInvitation?.organizationId, WAITING_INVITED_ORG_ID);
    assert.strictEqual(status.pendingInvitation?.organizationName, `Invited Org ${RUN_ID}`);
    assert.strictEqual(status.pendingInvitation?.role, 'teacher');
    assert.strictEqual(status.pendingInvitation?.requiresMigration, false);
  });

  it('keeps the current membership visible while surfacing a transfer invitation', async () => {
    await openpathDb.insert(openpathSchema.users).values({
      id: TRANSFER_USER_ID,
      email: `onboarding-status-transfer-${RUN_ID}@example.com`,
      name: 'Transfer User',
      passwordHash: 'hashed-password',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(schema.cpOrganizations).values([
      {
        id: CURRENT_ORG_ID,
        name: `Current Org ${RUN_ID}`,
        createdBy: TRANSFER_USER_ID,
      },
      {
        id: TRANSFER_INVITED_ORG_ID,
        name: `Invited Org ${RUN_ID}`,
        createdBy: TRANSFER_USER_ID,
      },
    ]);

    await db.insert(schema.cpMemberships).values({
      id: `membership_transfer_${RUN_ID}`,
      userId: TRANSFER_USER_ID,
      organizationId: CURRENT_ORG_ID,
      role: 'teacher',
      invitedBy: TRANSFER_USER_ID,
    });

    await db.insert(schema.cpInvitations).values({
      id: INVITATION_IDS[1],
      organizationId: TRANSFER_INVITED_ORG_ID,
      email: `onboarding-status-transfer-${RUN_ID}@example.com`,
      name: 'Transfer User',
      role: 'teacher',
      tokenHash: `transfer${RUN_ID}`.padEnd(64, 'b'),
      invitedBy: TRANSFER_USER_ID,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const status = await getOnboardingStatus(TRANSFER_USER_ID);
    assert.strictEqual(status.hasMembership, true);
    assert.strictEqual(status.organization?.id, CURRENT_ORG_ID);
    assert.strictEqual(status.organization?.name, `Current Org ${RUN_ID}`);
    assert.strictEqual(status.pendingInvitation?.organizationId, TRANSFER_INVITED_ORG_ID);
    assert.strictEqual(status.pendingInvitation?.organizationName, `Invited Org ${RUN_ID}`);
    assert.strictEqual(status.pendingInvitation?.requiresMigration, true);
  });
});
