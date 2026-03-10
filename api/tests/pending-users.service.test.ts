import { after, before, describe, test } from 'node:test';
import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  approveUser,
  listPendingUsers,
  rejectUser,
} from '../src/services/pending-users.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_pending_${RUN_ID}`;
const APPROVER_ID = `approver_pending_${RUN_ID}`;
const WAITING_USER_ID = `waiting_pending_${RUN_ID}`;
const REJECTED_USER_ID = `rejected_pending_${RUN_ID}`;
const MISSING_PROFILE_USER_ID = `missing_profile_pending_${RUN_ID}`;

async function deleteWaitingStatus(userId: string): Promise<void> {
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}

describe('pending-users.service', () => {
  before(async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteWaitingStatus(REJECTED_USER_ID);
    await deleteWaitingStatus(MISSING_PROFILE_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, REJECTED_USER_ID));
    await db
      .delete(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, MISSING_PROFILE_USER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, REJECTED_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, MISSING_PROFILE_USER_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, APPROVER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, REJECTED_USER_ID));

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: APPROVER_ID,
        email: `${APPROVER_ID}@example.com`,
        name: 'Pending Approver',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: WAITING_USER_ID,
        email: `${WAITING_USER_ID}@example.com`,
        name: 'Waiting User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: REJECTED_USER_ID,
        email: `${REJECTED_USER_ID}@example.com`,
        name: 'Rejected User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Pending Org ${RUN_ID}`,
      createdBy: APPROVER_ID,
    });
  });

  after(async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteWaitingStatus(REJECTED_USER_ID);
    await deleteWaitingStatus(MISSING_PROFILE_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, REJECTED_USER_ID));
    await db
      .delete(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, MISSING_PROFILE_USER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, REJECTED_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, MISSING_PROFILE_USER_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, APPROVER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, REJECTED_USER_ID));
  });

  test('listPendingUsers returns only waiting users with OpenPath profiles and [] when none are waiting', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await deleteWaitingStatus(MISSING_PROFILE_USER_ID);

    const emptyPendingUsers = await listPendingUsers(ORG_ID);
    assert.deepStrictEqual(emptyPendingUsers, []);

    await db.insert(schema.cpUserStatus).values([
      {
        userId: WAITING_USER_ID,
        status: 'waiting',
        targetOrganizationId: ORG_ID,
      },
      {
        userId: MISSING_PROFILE_USER_ID,
        status: 'waiting',
        targetOrganizationId: ORG_ID,
      },
    ]);

    const pendingUsers = await listPendingUsers(ORG_ID);
    assert.strictEqual(pendingUsers.length, 1);
    assert.strictEqual(pendingUsers[0]?.userId, WAITING_USER_ID);
    assert.strictEqual(pendingUsers[0]?.email, `${WAITING_USER_ID}@example.com`);
  });

  test('listPendingUsers scopes the OpenPath lookup to the waiting user ids', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);

    await db.insert(schema.cpUserStatus).values({
      userId: WAITING_USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    const originalSelect = openpathDb.select.bind(openpathDb);
    let scopedLookupSql = '';

    (openpathDb as any).select = (...args: any[]) => {
      const builder = originalSelect(...args);
      const originalFrom = builder.from.bind(builder);

      builder.from = (...fromArgs: any[]) => {
        const result = originalFrom(...fromArgs);
        const originalWhere = result.where.bind(result);

        result.where = (...whereArgs: any[]) => {
          const whereResult = originalWhere(...whereArgs);
          scopedLookupSql = whereResult.toSQL().sql;
          return whereResult;
        };

        return result;
      };

      return builder;
    };

    try {
      await listPendingUsers(ORG_ID);
    } finally {
      (openpathDb as any).select = originalSelect;
    }

    assert.match(scopedLookupSql, /where/i);
    assert.match(scopedLookupSql, / in /i);
  });

  test('approveUser upgrades an existing lower OpenPath role instead of creating a duplicate', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));

    await db.insert(schema.cpUserStatus).values({
      userId: WAITING_USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-viewer-${RUN_ID}`,
      userId: WAITING_USER_ID,
      role: 'viewer',
      groupIds: [],
      createdBy: APPROVER_ID,
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

    const waitingStatus = await db
      .select()
      .from(schema.cpUserStatus)
      .where(eq(schema.cpUserStatus.userId, WAITING_USER_ID));
    assert.strictEqual(waitingStatus.length, 0);
  });

  test('approveUser demotes an existing higher OpenPath role when the tenant role is lower', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));

    await db.insert(schema.cpUserStatus).values({
      userId: WAITING_USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-admin-${RUN_ID}`,
      userId: WAITING_USER_ID,
      role: 'admin',
      groupIds: [],
      createdBy: APPROVER_ID,
    });

    await approveUser(WAITING_USER_ID, ORG_ID, 'teacher', APPROVER_ID);

    const roles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, WAITING_USER_ID));
    assert.strictEqual(roles.length, 1);
    assert.strictEqual(String(roles[0]?.role), 'teacher');
  });

  test('approveUser rejects users that are not waiting for the organization', async () => {
    await deleteWaitingStatus(WAITING_USER_ID);
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, WAITING_USER_ID));

    await assert.rejects(
      approveUser(WAITING_USER_ID, ORG_ID, 'teacher', APPROVER_ID),
      /not waiting for this organization/i
    );
  });

  test('rejectUser clears waiting status for the targeted organization', async () => {
    await deleteWaitingStatus(REJECTED_USER_ID);

    await db.insert(schema.cpUserStatus).values({
      userId: REJECTED_USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    await rejectUser(REJECTED_USER_ID, ORG_ID);

    const waitingStatus = await db
      .select()
      .from(schema.cpUserStatus)
      .where(eq(schema.cpUserStatus.userId, REJECTED_USER_ID));
    assert.strictEqual(waitingStatus.length, 0);
  });
});
