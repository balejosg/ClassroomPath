import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  clearWaitingStatus,
  listWaitingUsersForOrganization,
  setWaitingStatus,
  setWaitingStatusWithOrg,
} from '../src/services/waiting-status.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_waiting_status_${RUN_ID}`;
const USER_ID = `user_waiting_status_${RUN_ID}`;

describe('waiting-status.service', () => {
  before(async () => {
    await acquireTestDbLock();

    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, USER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Waiting Status Org ${RUN_ID}`,
      createdBy: USER_ID,
    });

    await openpathDb.insert(openpathSchema.users).values({
      id: USER_ID,
      email: `waiting-status-${RUN_ID}@example.com`,
      name: 'Waiting Status User',
      passwordHash: 'hashed-password',
      isActive: true,
      emailVerified: true,
    });
  });

  after(async () => {
    try {
      await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, USER_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('lists waiting users for an organization and clears waiting status', async () => {
    await setWaitingStatus(USER_ID);
    await setWaitingStatusWithOrg(USER_ID, ORG_ID);

    const rows = await db
      .select({
        userId: schema.cpUserStatus.userId,
        status: schema.cpUserStatus.status,
        targetOrganizationId: schema.cpUserStatus.targetOrganizationId,
      })
      .from(schema.cpUserStatus)
      .where(eq(schema.cpUserStatus.userId, USER_ID))
      .limit(1);

    assert.deepStrictEqual(rows[0], {
      userId: USER_ID,
      status: 'waiting',
      targetOrganizationId: ORG_ID,
    });

    const waitingUsers = await listWaitingUsersForOrganization(ORG_ID);
    assert.strictEqual(waitingUsers.length, 1);
    assert.strictEqual(waitingUsers[0]?.userId, USER_ID);
    assert.strictEqual(waitingUsers[0]?.email, `waiting-status-${RUN_ID}@example.com`);
    assert.strictEqual(waitingUsers[0]?.name, 'Waiting Status User');

    await clearWaitingStatus(USER_ID);

    const remaining = await db
      .select({ userId: schema.cpUserStatus.userId })
      .from(schema.cpUserStatus)
      .where(
        and(eq(schema.cpUserStatus.userId, USER_ID), eq(schema.cpUserStatus.status, 'waiting'))
      );
    assert.strictEqual(remaining.length, 0);
  });
});
