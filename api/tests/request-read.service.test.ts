import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, requests, roles, users, whitelistGroups } from '../src/db/openpath.js';
import {
  getTenantRequestStats,
  listAccessibleRequestGroups,
  listTenantRequests,
} from '../src/services/request-read.service.js';
import type { TenantProcedureContext } from '../src/trpc/tenant-procedure-helpers.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const TEACHER_ID = `req_read_teacher_${RUN_ID}`;
const ORG_ID = `req_read_org_${RUN_ID}`;
const VISIBLE_GROUP_ID = `req_read_group_visible_${RUN_ID}`;
const HIDDEN_GROUP_ID = `req_read_group_hidden_${RUN_ID}`;
const ROLE_ID = `req_read_role_${RUN_ID}`;
const ORG_GROUP_IDS = [`req_read_org_group_a_${RUN_ID}`, `req_read_org_group_b_${RUN_ID}`];
const REQUEST_IDS = [
  `req_read_request_pending_${RUN_ID}`,
  `req_read_request_approved_${RUN_ID}`,
  `req_read_request_hidden_${RUN_ID}`,
];

function teacherContext(): TenantProcedureContext {
  return {
    user: {
      sub: TEACHER_ID,
      email: `request-read-${RUN_ID}@example.com`,
      name: 'Request Read Teacher',
    },
    organizationId: ORG_ID,
    userRole: 'teacher',
  } as TenantProcedureContext;
}

describe('request-read.service', () => {
  before(async () => {
    await acquireTestDbLock();

    await openpathDb.delete(requests).where(inArray(requests.id, REQUEST_IDS));
    await openpathDb.delete(roles).where(eq(roles.id, ROLE_ID));
    await db
      .delete(schema.cpOrganizationGroups)
      .where(inArray(schema.cpOrganizationGroups.id, ORG_GROUP_IDS));
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, TEACHER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(whitelistGroups)
      .where(inArray(whitelistGroups.id, [VISIBLE_GROUP_ID, HIDDEN_GROUP_ID]));
    await openpathDb.delete(users).where(eq(users.id, TEACHER_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Request Read Org ${RUN_ID}`,
      createdBy: TEACHER_ID,
    });

    await db.insert(schema.cpMemberships).values({
      id: `req_read_membership_${RUN_ID}`,
      organizationId: ORG_ID,
      userId: TEACHER_ID,
      role: 'teacher',
      invitedBy: TEACHER_ID,
    });

    await openpathDb.insert(users).values({
      id: TEACHER_ID,
      email: `request-read-${RUN_ID}@example.com`,
      name: 'Request Read Teacher',
      passwordHash: 'hashed-password',
      isActive: true,
    });

    await openpathDb.insert(whitelistGroups).values([
      {
        id: VISIBLE_GROUP_ID,
        name: `request-read-visible-${RUN_ID}`.slice(0, 100),
        displayName: 'Visible Request Group',
        enabled: 1,
      },
      {
        id: HIDDEN_GROUP_ID,
        name: `request-read-hidden-${RUN_ID}`.slice(0, 100),
        displayName: 'Hidden Request Group',
        enabled: 1,
      },
    ]);

    await db.insert(schema.cpOrganizationGroups).values([
      {
        id: ORG_GROUP_IDS[0],
        organizationId: ORG_ID,
        groupId: VISIBLE_GROUP_ID,
        publicName: `visible-${RUN_ID}`,
      },
      {
        id: ORG_GROUP_IDS[1],
        organizationId: ORG_ID,
        groupId: HIDDEN_GROUP_ID,
        publicName: `hidden-${RUN_ID}`,
      },
    ]);

    await openpathDb.insert(roles).values({
      id: ROLE_ID,
      userId: TEACHER_ID,
      role: 'teacher',
      groupIds: [VISIBLE_GROUP_ID],
      createdBy: TEACHER_ID,
    });

    await openpathDb.insert(requests).values([
      {
        id: REQUEST_IDS[0],
        domain: `pending-${RUN_ID}.example.com`,
        requesterEmail: `request-read-${RUN_ID}@example.com`,
        groupId: VISIBLE_GROUP_ID,
        status: 'pending',
      },
      {
        id: REQUEST_IDS[1],
        domain: `approved-${RUN_ID}.example.com`,
        requesterEmail: `request-read-${RUN_ID}@example.com`,
        groupId: VISIBLE_GROUP_ID,
        status: 'approved',
      },
      {
        id: REQUEST_IDS[2],
        domain: `hidden-${RUN_ID}.example.com`,
        requesterEmail: `request-read-${RUN_ID}@example.com`,
        groupId: HIDDEN_GROUP_ID,
        status: 'pending',
      },
    ]);
  });

  after(async () => {
    try {
      await openpathDb.delete(requests).where(inArray(requests.id, REQUEST_IDS));
      await openpathDb.delete(roles).where(eq(roles.id, ROLE_ID));
      await db
        .delete(schema.cpOrganizationGroups)
        .where(inArray(schema.cpOrganizationGroups.id, ORG_GROUP_IDS));
      await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, TEACHER_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb
        .delete(whitelistGroups)
        .where(inArray(whitelistGroups.id, [VISIBLE_GROUP_ID, HIDDEN_GROUP_ID]));
      await openpathDb.delete(users).where(eq(users.id, TEACHER_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('filters request groups and queue rows to the teacher-visible tenant scope', async () => {
    const ctx = teacherContext();

    const groups = await listAccessibleRequestGroups(ctx);
    const stats = await getTenantRequestStats(ctx);
    const pendingRequests = await listTenantRequests(ctx, 'pending');
    const allRequests = await listTenantRequests(ctx);

    assert.deepStrictEqual(groups, [
      {
        name: 'Visible Request Group',
        path: VISIBLE_GROUP_ID,
      },
    ]);

    assert.deepStrictEqual(stats, {
      total: 2,
      pending: 1,
      approved: 1,
      rejected: 0,
    });

    assert.strictEqual(pendingRequests.length, 1);
    assert.strictEqual(pendingRequests[0]?.id, REQUEST_IDS[0]);
    assert.strictEqual(pendingRequests[0]?.createdAt !== null, true);

    assert.deepStrictEqual(
      allRequests.map((request) => request.id),
      [REQUEST_IDS[0], REQUEST_IDS[1]]
    );

    const hiddenRequest = await openpathDb
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.id, REQUEST_IDS[2]), eq(requests.groupId, HIDDEN_GROUP_ID)))
      .limit(1);
    assert.strictEqual(hiddenRequest.length, 1);
  });
});
