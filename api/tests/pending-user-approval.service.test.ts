import { after, before, describe, test } from 'node:test';
import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { approveUser } from '../src/services/pending-user-approval.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_pending_approval_${RUN_ID}`;
const APPROVER_ID = `approver_pending_approval_${RUN_ID}`;
const WAITING_USER_ID = `waiting_pending_approval_${RUN_ID}`;

async function deleteWaitingStatus(userId: string): Promise<void> {
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}

async function deleteMutationOperations(userId: string): Promise<void> {
  await db
    .delete(schema.cpMutationOperations)
    .where(eq(schema.cpMutationOperations.userId, userId));
}

describe('pending-user-approval.service', () => {
  before(async () => {
    await acquireTestDbLock();
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteMutationOperations(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, APPROVER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, WAITING_USER_ID));

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: APPROVER_ID,
        email: `${APPROVER_ID}@example.com`,
        name: 'Pending Approval Approver',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: WAITING_USER_ID,
        email: `${WAITING_USER_ID}@example.com`,
        name: 'Pending Approval User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Pending Approval Org ${RUN_ID}`,
      createdBy: APPROVER_ID,
    });
  });

  after(async () => {
    try {
      await deleteWaitingStatus(WAITING_USER_ID);
      await deleteMutationOperations(WAITING_USER_ID);
      await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb
        .delete(openpathSchema.roles)
        .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
      await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, APPROVER_ID));
      await openpathDb
        .delete(openpathSchema.users)
        .where(eq(openpathSchema.users.id, WAITING_USER_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  test('approveUser creates tenant membership and syncs upstream role', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteMutationOperations(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));

    await db.insert(schema.cpUserStatus).values({
      userId: WAITING_USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    const result = await approveUser(WAITING_USER_ID, ORG_ID, 'teacher', APPROVER_ID);
    assert.ok(result.membershipId.startsWith('mem_'));

    const memberships = await db
      .select()
      .from(schema.cpMemberships)
      .where(
        and(
          eq(schema.cpMemberships.userId, WAITING_USER_ID),
          eq(schema.cpMemberships.organizationId, ORG_ID)
        )
      );
    assert.strictEqual(memberships.length, 1);
    assert.strictEqual(memberships[0]?.role, 'teacher');

    const roles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
    assert.strictEqual(roles.length, 1);
    assert.strictEqual(String(roles[0]?.role), 'teacher');
  });

  test('approveUser rejects users that are not waiting for the organization', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteMutationOperations(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));

    await assert.rejects(
      approveUser(WAITING_USER_ID, ORG_ID, 'teacher', APPROVER_ID),
      /not waiting for this organization/i
    );
  });
});
