import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import {
  openpathDb,
  requests,
  roles,
  users,
  whitelistGroups,
  whitelistRules,
} from '../src/db/openpath.js';
import {
  approveTenantRequest,
  createTenantRequest,
  deleteTenantRequest,
  rejectTenantRequest,
} from '../src/services/request-write.service.js';
import type { TenantProcedureContext } from '../src/trpc/tenant-procedure-helpers.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const TEACHER_ID = `req_write_teacher_${RUN_ID}`;
const ADMIN_ID = `req_write_admin_${RUN_ID}`;
const ORG_ID = `req_write_org_${RUN_ID}`;
const GROUP_ID = `req_write_group_${RUN_ID}`;
const ROLE_ID = `req_write_role_${RUN_ID}`;
const ORG_GROUP_ID = `req_write_org_group_${RUN_ID}`;
const SEEDED_REQUEST_IDS = [`req_write_reject_${RUN_ID}`, `req_write_delete_${RUN_ID}`];

function teacherContext(): TenantProcedureContext {
  return {
    user: {
      sub: TEACHER_ID,
      email: `request-write-teacher-${RUN_ID}@example.com`,
      name: 'Request Write Teacher',
    },
    organizationId: ORG_ID,
    userRole: 'teacher',
  } as TenantProcedureContext;
}

function adminContext(): TenantProcedureContext {
  return {
    user: {
      sub: ADMIN_ID,
      email: `request-write-admin-${RUN_ID}@example.com`,
      name: 'Request Write Admin',
    },
    organizationId: ORG_ID,
    userRole: 'admin',
  } as TenantProcedureContext;
}

describe('request-write.service', () => {
  before(async () => {
    await acquireTestDbLock();

    await openpathDb.delete(requests).where(inArray(requests.id, SEEDED_REQUEST_IDS));
    await openpathDb.delete(roles).where(eq(roles.id, ROLE_ID));
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.userId, [TEACHER_ID, ADMIN_ID]));
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.id, ORG_GROUP_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, GROUP_ID));
    await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, GROUP_ID));
    await openpathDb.delete(users).where(inArray(users.id, [TEACHER_ID, ADMIN_ID]));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Request Write Org ${RUN_ID}`,
      createdBy: ADMIN_ID,
    });

    await db.insert(schema.cpMemberships).values([
      {
        id: `req_write_membership_teacher_${RUN_ID}`,
        organizationId: ORG_ID,
        userId: TEACHER_ID,
        role: 'teacher',
        invitedBy: ADMIN_ID,
      },
      {
        id: `req_write_membership_admin_${RUN_ID}`,
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: 'admin',
        invitedBy: ADMIN_ID,
      },
    ]);

    await openpathDb.insert(users).values([
      {
        id: TEACHER_ID,
        email: `request-write-teacher-${RUN_ID}@example.com`,
        name: 'Request Write Teacher',
        passwordHash: 'hashed-password',
        isActive: true,
      },
      {
        id: ADMIN_ID,
        email: `request-write-admin-${RUN_ID}@example.com`,
        name: 'Request Write Admin',
        passwordHash: 'hashed-password',
        isActive: true,
      },
    ]);

    await openpathDb.insert(whitelistGroups).values({
      id: GROUP_ID,
      name: `request-write-group-${RUN_ID}`.slice(0, 100),
      displayName: 'Request Write Group',
      enabled: 1,
    });

    await db.insert(schema.cpOrganizationGroups).values({
      id: ORG_GROUP_ID,
      organizationId: ORG_ID,
      groupId: GROUP_ID,
      publicName: `request-write-${RUN_ID}`,
    });

    await openpathDb.insert(roles).values({
      id: ROLE_ID,
      userId: TEACHER_ID,
      role: 'teacher',
      groupIds: [GROUP_ID],
      createdBy: ADMIN_ID,
    });
  });

  after(async () => {
    try {
      const createdRequests = await openpathDb
        .select({ id: requests.id })
        .from(requests)
        .where(eq(requests.groupId, GROUP_ID));
      const requestIds = [...SEEDED_REQUEST_IDS, ...createdRequests.map((request) => request.id)];

      if (requestIds.length > 0) {
        await openpathDb.delete(requests).where(inArray(requests.id, requestIds));
      }

      await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, GROUP_ID));
      await openpathDb.delete(roles).where(eq(roles.id, ROLE_ID));
      await db
        .delete(schema.cpMemberships)
        .where(inArray(schema.cpMemberships.userId, [TEACHER_ID, ADMIN_ID]));
      await db
        .delete(schema.cpOrganizationGroups)
        .where(eq(schema.cpOrganizationGroups.id, ORG_GROUP_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, GROUP_ID));
      await openpathDb.delete(users).where(inArray(users.id, [TEACHER_ID, ADMIN_ID]));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('creates and approves a tenant request inside the caller tenant scope', async () => {
    const created = await createTenantRequest({
      ctx: teacherContext(),
      input: {
        domain: `created-${RUN_ID}.example.com`,
        groupId: GROUP_ID,
        reason: 'teacher request',
      },
    });

    assert.strictEqual(created.domain, `created-${RUN_ID}.example.com`);
    assert.strictEqual(created.groupId, GROUP_ID);
    assert.strictEqual(created.status, 'pending');

    const approval = await approveTenantRequest(teacherContext(), created.id);
    assert.deepStrictEqual(approval, { success: true });

    const [updatedRequest] = await openpathDb
      .select()
      .from(requests)
      .where(eq(requests.id, created.id))
      .limit(1);
    assert.strictEqual(updatedRequest?.status, 'approved');
    assert.strictEqual(updatedRequest?.resolvedBy, 'Request Write Teacher');

    const insertedRule = await openpathDb
      .select({ id: whitelistRules.id })
      .from(whitelistRules)
      .where(
        and(
          eq(whitelistRules.groupId, GROUP_ID),
          eq(whitelistRules.type, 'whitelist'),
          eq(whitelistRules.value, `created-${RUN_ID}.example.com`)
        )
      )
      .limit(1);
    assert.strictEqual(insertedRule.length, 1);
  });

  it('rejects and deletes tenant requests through the tenant facade operations', async () => {
    await openpathDb.insert(requests).values([
      {
        id: SEEDED_REQUEST_IDS[0],
        domain: `reject-${RUN_ID}.example.com`,
        requesterEmail: `request-write-admin-${RUN_ID}@example.com`,
        groupId: GROUP_ID,
        status: 'pending',
      },
      {
        id: SEEDED_REQUEST_IDS[1],
        domain: `delete-${RUN_ID}.example.com`,
        requesterEmail: `request-write-admin-${RUN_ID}@example.com`,
        groupId: GROUP_ID,
        status: 'pending',
      },
    ]);

    const rejection = await rejectTenantRequest(
      adminContext(),
      SEEDED_REQUEST_IDS[0],
      'not allowed'
    );
    assert.deepStrictEqual(rejection, { success: true });

    const [rejectedRequest] = await openpathDb
      .select()
      .from(requests)
      .where(eq(requests.id, SEEDED_REQUEST_IDS[0]))
      .limit(1);
    assert.strictEqual(rejectedRequest?.status, 'rejected');
    assert.strictEqual(rejectedRequest?.resolutionNote, 'not allowed');

    const deletion = await deleteTenantRequest(adminContext(), SEEDED_REQUEST_IDS[1]);
    assert.deepStrictEqual(deletion, { success: true });

    const deletedRequest = await openpathDb
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.id, SEEDED_REQUEST_IDS[1]))
      .limit(1);
    assert.strictEqual(deletedRequest.length, 0);
  });
});
