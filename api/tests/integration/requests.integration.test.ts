/**
 * ClassroomPath requests integration tests (/cp/trpc/requests.*)
 */

import { TEST_JWT_SECRET } from '../helpers/test-env.js';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { eq, and } from 'drizzle-orm';

import {
  trpcMutate,
  trpcQuery,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import { signToken, useIntegrationServer } from './harness.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

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

  await db.insert(cpSchema.cpOrganizationEntitlements).values({
    organizationId: params.orgId,
    source: 'manual_admin',
    status: 'active',
    productKind: 'annual',
    classroomLimit: 100,
    grantedBy: params.userId,
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
    publicName: params.groupId,
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

function createMockPushSubscription(label: string) {
  const suffix = encodeURIComponent(label);
  return {
    endpoint: `https://push.example.test/${suffix}`,
    expirationTime: null,
    keys: {
      p256dh: `p256dh-${suffix}`,
      auth: `auth-${suffix}`,
    },
  };
}

describe('ClassroomPath requests integration (/cp/trpc)', async () => {
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
      integration.baseUrl,
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

  test('approve creates root whitelist rule for legacy subdomain requests', async () => {
    await resetDb();

    const userId = 'req-admin-root-legacy';
    const email = uniqueEmail('req-admin-root-legacy');
    const orgId = 'org-req-root-legacy';
    const groupId = 'group-req-root-legacy';
    const requestId = 'request-req-root-legacy';

    await seedOpenPathUser({ userId, email, name: 'Req Root Legacy Admin' });
    await seedTenant({ orgId, userId, userRole: 'admin' });
    await seedGroupForOrg({ orgId, groupId });
    await seedRequest({ requestId, groupId, domain: 'es.wikipedia.org' });

    const token = signToken({
      userId,
      email,
      name: 'Req Root Legacy Admin',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcMutate(
      integration.baseUrl,
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
          eq(openpathSchema.whitelistRules.value, 'wikipedia.org')
        )
      )
      .limit(1);
    assert.strictEqual(createdRule.length, 1);
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
      jwtSecret: TEST_JWT_SECRET,
      userId: adminAId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcMutate(
      integration.baseUrl,
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
      jwtSecret: TEST_JWT_SECRET,
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher 1',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const deniedResp = await trpcMutate(
      integration.baseUrl,
      'requests.approve',
      { id: requestId },
      bearerAuth(deniedToken)
    );
    assertStatus(deniedResp, 403);

    const allowedToken = signToken({
      jwtSecret: TEST_JWT_SECRET,
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher 1',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    await seedTeacherRoleOwnership({ userId: teacherId, groupId });

    const allowedResp = await trpcMutate(
      integration.baseUrl,
      'requests.approve',
      { id: requestId },
      bearerAuth(allowedToken)
    );
    assertStatus(allowedResp, 200);
  });

  test('push.subscribe stores subscriptions only for teacher-accessible tenant groups', async () => {
    await resetDb();

    const teacherId = 'req-push-teacher';
    const teacherEmail = uniqueEmail('req-push-teacher');
    const orgId = 'org-push-teacher';
    const ownedGroupId = 'group-push-owned';
    const otherGroupId = 'group-push-other';

    await seedOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Push Teacher' });
    await seedTenant({ orgId, userId: teacherId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId: ownedGroupId });
    await seedGroupForOrg({ orgId, groupId: otherGroupId });
    await seedTeacherRoleOwnership({ userId: teacherId, groupId: ownedGroupId });

    const token = signToken({
      jwtSecret: TEST_JWT_SECRET,
      userId: teacherId,
      email: teacherEmail,
      name: 'Push Teacher',
      roles: [{ role: 'teacher', groupIds: [ownedGroupId] }],
    });

    const deniedResp = await trpcMutate(
      integration.baseUrl,
      'push.subscribe',
      {
        subscription: createMockPushSubscription('denied'),
        groupIds: [otherGroupId],
      },
      bearerAuth(token)
    );
    assertStatus(deniedResp, 403);

    const allowedResp = await trpcMutate(
      integration.baseUrl,
      'push.subscribe',
      {
        subscription: createMockPushSubscription('allowed'),
        groupIds: [ownedGroupId],
      },
      bearerAuth(token)
    );
    assertStatus(allowedResp, 200);

    const parsed = (await parseTRPC(allowedResp)) as {
      data?: { success?: boolean; subscriptionId?: string; groupIds?: string[] };
    };
    assert.strictEqual(parsed.data?.success, true);
    assert.ok(parsed.data?.subscriptionId);
    assert.deepStrictEqual(parsed.data?.groupIds, [ownedGroupId]);
  });

  test('notification approve action uses cookie session to approve one pending request', async () => {
    await resetDb();

    const teacherId = 'req-action-teacher';
    const teacherEmail = uniqueEmail('req-action-teacher');
    const orgId = 'org-action-teacher';
    const groupId = 'group-action-owned';
    const requestId = 'request-action-approve';

    await seedOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Action Teacher' });
    await seedTenant({ orgId, userId: teacherId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId });
    await seedTeacherRoleOwnership({ userId: teacherId, groupId });
    await seedRequest({ requestId, groupId, domain: 'approve-from-notification.test' });

    const token = signToken({
      jwtSecret: TEST_JWT_SECRET,
      userId: teacherId,
      email: teacherEmail,
      name: 'Action Teacher',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    const response = await fetch(
      `${integration.baseUrl}/cp/notification-actions/domain-request/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `cp_access_token=${token}`,
          Origin: integration.baseUrl,
        },
        body: JSON.stringify({ requestId }),
      }
    );

    assertStatus(response, 200);
    assert.deepStrictEqual(await response.json(), {
      status: 'approved',
      requestId,
    });

    const updatedRequest = await openpathDb
      .select()
      .from(openpathSchema.requests)
      .where(eq(openpathSchema.requests.id, requestId))
      .limit(1);
    assert.strictEqual(updatedRequest[0]?.status, 'approved');
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
      integration.baseUrl,
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
      integration.baseUrl,
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
      integration.baseUrl,
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
      integration.baseUrl,
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

  test('create normalizes subdomains and duplicate detection is root-based', async () => {
    await resetDb();

    const userId = 'req-create-root';
    const email = uniqueEmail('req-create-root');
    const orgId = 'org-create-root';
    const groupId = 'grp-create-root';

    await seedOpenPathUser({ userId, email, name: 'Create Root' });
    await seedTenant({ orgId, userId, userRole: 'teacher' });
    await seedGroupForOrg({ orgId, groupId });
    await seedTeacherRoleOwnership({ userId, groupId });

    const token = signToken({
      userId,
      email,
      name: 'Create Root',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    const createResp = await trpcMutate(
      integration.baseUrl,
      'requests.create',
      {
        domain: 'es.wikipedia.org',
        groupId,
        reason: 'tenant scoped root create',
      },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);
    const parsed = (await parseTRPC(createResp)) as {
      data?: { domain: string };
    };
    assert.strictEqual(parsed.data?.domain, 'wikipedia.org');

    const duplicateResp = await trpcMutate(
      integration.baseUrl,
      'requests.create',
      {
        domain: 'mobile.wikipedia.org',
        groupId,
        reason: 'same root duplicate',
      },
      bearerAuth(token)
    );
    assertStatus(duplicateResp, 409);
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

    const resp = await trpcQuery(
      integration.baseUrl,
      'requests.listGroups',
      undefined,
      bearerAuth(token)
    );
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

    const resp = await trpcQuery(
      integration.baseUrl,
      'requests.stats',
      undefined,
      bearerAuth(token)
    );
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
