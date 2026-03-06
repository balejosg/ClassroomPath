/**
 * ClassroomPath requests integration tests (/cp/trpc/requests.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';

import {
  getAvailablePort,
  trpcMutate,
  trpcQuery,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
  waitForHealth,
} from '../test-utils.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;
let server: Server | undefined;

function signToken(params: { userId: string; email: string; name: string; roles: any[] }): string {
  return jwt.sign(
    {
      sub: params.userId,
      email: params.email,
      name: params.name,
      roles: params.roles,
    },
    JWT_SECRET
  );
}

async function seedTenant(params: {
  orgId: string;
  userId: string;
  userRole: 'admin' | 'teacher';
}) {
  await db.insert(cpSchema.cpOrganizations).values({
    id: params.orgId,
    name: `Org ${params.orgId}`,
    createdBy: params.userId,
  });

  await db.insert(cpSchema.cpMemberships).values({
    id: `m-${params.userId}`,
    userId: params.userId,
    organizationId: params.orgId,
    role: params.userRole,
    invitedBy: params.userId,
  });
}

async function seedOpenPathUser(params: { userId: string; email: string; name: string }) {
  await openpathDb.insert(openpathSchema.users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed',
  });
}

async function seedGroupForOrg(params: { orgId: string; groupId: string }) {
  await openpathDb.insert(openpathSchema.whitelistGroups).values({
    id: params.groupId,
    name: params.groupId,
    displayName: params.groupId,
    enabled: 1,
  });

  await db.insert(cpSchema.cpOrganizationGroups).values({
    id: `og-${params.orgId}-${params.groupId}`,
    organizationId: params.orgId,
    groupId: params.groupId,
  });
}

async function seedRequest(params: { requestId: string; groupId: string; domain: string }) {
  await openpathDb.insert(openpathSchema.requests).values({
    id: params.requestId,
    domain: params.domain,
    requesterEmail: 'requester@test.local',
    groupId: params.groupId,
    status: 'pending',
  });
}

async function seedTeacherRoleOwnership(params: {
  userId: string;
  groupId: string;
}): Promise<void> {
  await openpathDb.insert(openpathSchema.roles).values({
    id: `role-${params.userId}`,
    userId: params.userId,
    role: 'teacher',
    groupIds: [params.groupId],
    createdBy: params.userId,
  });
}

describe('ClassroomPath requests integration (/cp/trpc)', async () => {
  before(async () => {
    await resetDb();

    PORT = await getAvailablePort();
    API_URL = `http://localhost:${String(PORT)}`;
    process.env.CP_PORT = String(PORT);

    const { app } = await import('../../src/server.js');
    server = app.listen(PORT);
    await waitForHealth(API_URL);
  });

  after(async () => {
    const srv = server;
    server = undefined;
    if (srv !== undefined) {
      try {
        if ((srv as any).listening === true) {
          await new Promise<void>((resolve, reject) => {
            srv.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } catch (err: any) {
        if (err?.code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      }
    }

    await closeConnection();
    await closeOpenPathConnection();

    try {
      const undici: any = await import('undici');
      const dispatcher: any = undici.getGlobalDispatcher?.();
      if (typeof dispatcher?.close === 'function') {
        await dispatcher.close();
      }
    } catch {
      // best-effort
    }
  });

  test('approve creates whitelist rule and marks request approved', async () => {
    await resetDb();

    const userId = 'req-admin-1';
    const email = uniqueEmail('req-admin-1');
    const orgId = 'org-req-1';
    const groupId = 'group-req-1';
    const requestId = 'request-req-1';

    await seedOpenPathUser({ userId, email, name: 'Req Admin' });
    await seedTenant({ orgId, userId, userRole: 'admin' });
    await seedGroupForOrg({ orgId, groupId });
    await seedRequest({ requestId, groupId, domain: 'example.com' });

    const token = signToken({
      userId,
      email,
      name: 'Req Admin',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcMutate(
      API_URL,
      'requests.approve',
      { id: requestId },
      bearerAuth(token)
    );
    assertStatus(resp, 200);

    const createdRule = await openpathDb
      .select()
      .from(openpathSchema.whitelistRules)
      .where(
        and(
          eq(openpathSchema.whitelistRules.groupId, groupId),
          eq(openpathSchema.whitelistRules.type, 'whitelist'),
          eq(openpathSchema.whitelistRules.value, 'example.com')
        )
      )
      .limit(1);
    assert.strictEqual(createdRule.length, 1);

    const updatedRequest = await openpathDb
      .select()
      .from(openpathSchema.requests)
      .where(eq(openpathSchema.requests.id, requestId))
      .limit(1);
    assert.strictEqual(updatedRequest[0]?.status, 'approved');
  });

  test('approve is blocked for cross-tenant request', async () => {
    await resetDb();

    const adminAId = 'req-admin-a';
    const adminAEmail = uniqueEmail('req-admin-a');
    const orgA = 'org-a';
    const orgB = 'org-b';
    const groupB = 'group-b';
    const requestId = 'request-cross-tenant';

    await seedOpenPathUser({ userId: adminAId, email: adminAEmail, name: 'Admin A' });
    await seedTenant({ orgId: orgA, userId: adminAId, userRole: 'admin' });
    await db.insert(cpSchema.cpOrganizations).values({
      id: orgB,
      name: 'Org B',
      createdBy: adminAId,
    });
    await seedGroupForOrg({ orgId: orgB, groupId: groupB });
    await seedRequest({ requestId, groupId: groupB, domain: 'cross-tenant.com' });

    const token = signToken({
      userId: adminAId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcMutate(
      API_URL,
      'requests.approve',
      { id: requestId },
      bearerAuth(token)
    );
    assertStatus(resp, 403);
    const parsed = await parseTRPC(resp);
    assert.strictEqual(parsed.code, 'FORBIDDEN');
  });

  test('teacher requires group permission to approve', async () => {
    await resetDb();

    const teacherId = 'req-teacher-1';
    const teacherEmail = uniqueEmail('req-teacher-1');
    const orgId = 'org-teacher-1';
    const groupId = 'group-teacher-1';
    const requestId = 'request-teacher-1';

    await seedOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Teacher 1' });
    await seedTenant({ orgId, userId: teacherId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId });
    await seedRequest({ requestId, groupId, domain: 'teacher-denied.com' });

    const deniedToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher 1',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const deniedResp = await trpcMutate(
      API_URL,
      'requests.approve',
      { id: requestId },
      bearerAuth(deniedToken)
    );
    assertStatus(deniedResp, 403);

    const allowedToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher 1',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    await seedTeacherRoleOwnership({ userId: teacherId, groupId });

    const allowedResp = await trpcMutate(
      API_URL,
      'requests.approve',
      { id: requestId },
      bearerAuth(allowedToken)
    );
    assertStatus(allowedResp, 200);
  });

  test('reject marks request rejected and stores resolution note', async () => {
    await resetDb();

    const userId = 'req-admin-reject';
    const email = uniqueEmail('req-admin-reject');
    const orgId = 'org-reject';
    const groupId = 'group-reject';
    const requestId = 'request-reject';

    await seedOpenPathUser({ userId, email, name: 'Reject Admin' });
    await seedTenant({ orgId, userId, userRole: 'admin' });
    await seedGroupForOrg({ orgId, groupId });
    await seedRequest({ requestId, groupId, domain: 'reject-me.com' });

    const token = signToken({
      userId,
      email,
      name: 'Reject Admin',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcMutate(
      API_URL,
      'requests.reject',
      { id: requestId, reason: 'Educational policy' },
      bearerAuth(token)
    );
    assertStatus(resp, 200);

    const updatedRequest = await openpathDb
      .select()
      .from(openpathSchema.requests)
      .where(eq(openpathSchema.requests.id, requestId))
      .limit(1);
    assert.strictEqual(updatedRequest[0]?.status, 'rejected');
    assert.strictEqual(updatedRequest[0]?.resolutionNote, 'Educational policy');
  });

  test('create rejects tenant request without groupId', async () => {
    await resetDb();

    const userId = 'req-create-mg';
    const email = uniqueEmail('req-create-mg');
    const orgId = 'org-cmg';
    const groupId = 'grp-cmg';

    await seedOpenPathUser({ userId, email, name: 'Create Missing Group' });
    await seedTenant({ orgId, userId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId });

    const token = signToken({
      userId,
      email,
      name: 'Create Missing Group',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    const createResp = await trpcMutate(
      API_URL,
      'requests.create',
      {
        domain: 'missing-groupid.test',
        reason: 'missing group id regression',
      },
      bearerAuth(token)
    );
    assertStatus(createResp, 400);

    const parsed = await parseTRPC(createResp);
    assert.strictEqual(parsed.code, 'BAD_REQUEST');
    assert.strictEqual(parsed.error, 'groupId is required for tenant requests');
  });

  test('create with valid groupId is visible in tenant queue', async () => {
    await resetDb();

    const userId = 'req-create-vis';
    const email = uniqueEmail('req-create-vis');
    const orgId = 'org-cv';
    const groupId = 'grp-cv';

    await seedOpenPathUser({ userId, email, name: 'Create Visible' });
    await seedTenant({ orgId, userId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId });

    const token = signToken({
      userId,
      email,
      name: 'Create Visible',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    await seedTeacherRoleOwnership({ userId, groupId });

    const createResp = await trpcMutate(
      API_URL,
      'requests.create',
      {
        domain: 'tenant-visible-request.test',
        groupId,
        reason: 'tenant scoped create',
      },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);

    const listResp = await trpcQuery(
      API_URL,
      'requests.list',
      { status: 'pending' },
      bearerAuth(token)
    );
    assertStatus(listResp, 200);

    const parsed = (await parseTRPC(listResp)) as {
      data?: Array<{ domain: string; groupId: string }>;
    };
    const rows = parsed.data ?? [];
    const created = rows.find((row) => row.domain === 'tenant-visible-request.test');
    assert.ok(created, 'created request should appear in tenant list');
    assert.strictEqual(created?.groupId, groupId);
  });

  test('listGroups returns groups for tenant admin', async () => {
    await resetDb();

    const userId = 'req-admin-listgroups';
    const email = uniqueEmail('req-admin-listgroups');
    const orgId = 'org-listgroups';
    const groupId = 'group-listgroups-1';

    await seedOpenPathUser({ userId, email, name: 'ListGroups Admin' });
    await seedTenant({ orgId, userId, userRole: 'admin' });
    await seedGroupForOrg({ orgId, groupId });

    const token = signToken({
      userId,
      email,
      name: 'ListGroups Admin',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcQuery(API_URL, 'requests.listGroups', undefined, bearerAuth(token));
    assertStatus(resp, 200);

    const parsed = (await parseTRPC(resp)) as {
      data?: Array<{ name: string; path: string }>;
    };

    const groups = parsed.data ?? [];
    assert.ok(
      groups.some((g) => g.path === groupId),
      'expected group in listGroups results'
    );
  });

  test('stats counts requests by status for tenant admin', async () => {
    await resetDb();

    const userId = 'req-admin-stats';
    const email = uniqueEmail('req-admin-stats');
    const orgId = 'org-stats';
    const groupId = 'group-stats-1';

    await seedOpenPathUser({ userId, email, name: 'Stats Admin' });
    await seedTenant({ orgId, userId, userRole: 'admin' });
    await seedGroupForOrg({ orgId, groupId });

    await openpathDb.insert(openpathSchema.requests).values([
      {
        id: 'req-stats-1',
        domain: 'stats-pending.test',
        requesterEmail: 'requester@test.local',
        groupId,
        status: 'pending',
      },
      {
        id: 'req-stats-2',
        domain: 'stats-approved.test',
        requesterEmail: 'requester@test.local',
        groupId,
        status: 'approved',
      },
      {
        id: 'req-stats-3',
        domain: 'stats-rejected.test',
        requesterEmail: 'requester@test.local',
        groupId,
        status: 'rejected',
      },
    ]);

    const token = signToken({
      userId,
      email,
      name: 'Stats Admin',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcQuery(API_URL, 'requests.stats', undefined, bearerAuth(token));
    assertStatus(resp, 200);

    const parsed = (await parseTRPC(resp)) as {
      data?: { total: number; pending: number; approved: number; rejected: number };
    };

    assert.deepStrictEqual(parsed.data, {
      total: 3,
      pending: 1,
      approved: 1,
      rejected: 1,
    });
  });
});
