import { TEST_JWT_SECRET } from '../helpers/test-env.js';

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  bearerAuth,
  parseTRPC,
  resetDb,
  trpcMutate,
  trpcQuery,
  uniqueEmail,
} from '../test-utils.js';
import { useIntegrationServer } from './harness.js';
import { createTenantScenario, type TestActor } from './scenario-builder.js';
import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { appRouter } from '../../src/trpc/router.js';
import { enumerateProcedures } from '../tenant-isolation-manifest.js';
import { CROSS_TENANT_CASES, type TenantAResources } from './tenant-isolation-cases.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

interface TenantBActor {
  token: string;
}

const PROC_TYPE = new Map(enumerateProcedures(appRouter).map((p) => [p.path, p.type]));

/** Seed tenant A with one of every org-owned resource kind the registry references. */
async function seedTenantA(baseUrl: string): Promise<{
  resources: TenantAResources;
  adminA: TestActor;
}> {
  const scenario = createTenantScenario({ baseUrl, jwtSecret: TEST_JWT_SECRET });

  const { actor: adminA, organization: orgA } = await scenario.createOrgAdmin({
    userId: 'tenant-a-admin',
    organizationName: 'Tenant A',
  });

  // A teacher in org A (also the target user for user.* / auth.generateResetToken).
  const teacherA = await scenario.addTeacher({
    adminToken: adminA.token,
    organizationId: orgA.organizationId,
    userId: 'tenant-a-teacher',
  });

  // Group + classroom via the real tenant API (creates the cp_organization_* links).
  const groupA = await scenario.createGroup({
    token: adminA.token,
    name: 'tenant-a-group',
    displayName: 'Tenant A Group',
  });
  const classroomA = await scenario.createClassroom({
    token: adminA.token,
    name: 'tenant-a-classroom',
    displayName: 'Tenant A Classroom',
    defaultGroupId: groupA.id,
  });
  const scheduleA = await scenario.createWeeklySchedule({
    token: adminA.token,
    classroomId: classroomA.id,
    groupId: groupA.id,
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '09:00',
  });
  // Distinct from scheduleA: schedules.updateOneOff validates recurrence
  // (getOneOffScheduleBase) BEFORE assertOrgClassroomAccess, so exercising its
  // tenant guard requires a genuinely one-off schedule, not the weekly one.
  const oneOffScheduleA = await scenario.createOneOffSchedule({
    token: adminA.token,
    classroomId: classroomA.id,
    groupId: groupA.id,
    startAt: '2027-03-01T10:00:00.000Z',
    endAt: '2027-03-01T11:00:00.000Z',
  });

  // A published template (global shared catalog) sourced from org A's group.
  const publishResp = await trpcMutate(
    baseUrl,
    'templates.publishFromGroup',
    { groupId: groupA.id, name: 'tenant-a-template', displayName: 'Tenant A Template' },
    bearerAuth(adminA.token)
  );
  const publishParsed = await parseTRPC(publishResp);
  const templateId = (publishParsed.data as { id: string }).id;

  // Direct inserts for resources with no scenario-builder create path.
  await openpathDb.insert(openpathSchema.whitelistRules).values({
    id: 'rule-a',
    groupId: groupA.id,
    type: 'whitelist',
    value: 'a-resource.test',
  });
  await openpathDb.insert(openpathSchema.machines).values({
    id: 'machine-a',
    hostname: 'tenant-a-host',
    classroomId: classroomA.id,
  });
  await openpathDb.insert(openpathSchema.machineExemptions).values({
    id: 'exemption-a',
    machineId: 'machine-a',
    classroomId: classroomA.id,
    scheduleId: scheduleA.id,
    source: 'schedule',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await openpathDb.insert(openpathSchema.requests).values({
    id: 'req-a',
    domain: 'a-request.test',
    status: 'pending',
    requesterEmail: 'requester-a@test.local',
    groupId: groupA.id,
  });
  await openpathDb.insert(openpathSchema.pushSubscriptions).values({
    id: 'push-a',
    userId: teacherA.userId,
    groupIds: [groupA.id],
    endpoint: 'https://push.tenant-a.test/ep-a',
    p256dh: 'p256dh-a',
    auth: 'auth-a',
  });

  // A user waiting to join org A (target for pendingUsers.*).
  const pendingEmail = uniqueEmail('tenant-a-pending');
  await openpathDb.insert(openpathSchema.users).values({
    id: 'pending-a',
    email: pendingEmail,
    name: 'Pending A',
    passwordHash: 'hashed',
    isActive: true,
    emailVerified: true,
  });
  await db.insert(cpSchema.cpUserStatus).values({
    userId: 'pending-a',
    status: 'waiting',
    targetOrganizationId: orgA.organizationId,
  });

  // An invitation and a failed mutation operation, both org-A scoped.
  await db.insert(cpSchema.cpInvitations).values({
    id: 'inv-a',
    organizationId: orgA.organizationId,
    email: 'invitee-a@test.local',
    name: 'Invitee A',
    role: 'teacher',
    tokenHash: 'token-hash-a',
    invitedBy: adminA.userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await db.insert(cpSchema.cpMutationOperations).values({
    id: 'op-a',
    operationType: 'assign_role',
    idempotencyKey: 'op-a-key',
    status: 'failed',
    currentStep: 'apply',
    organizationId: orgA.organizationId,
    userId: teacherA.userId,
  });

  return {
    adminA,
    resources: {
      orgId: orgA.organizationId,
      groupId: groupA.id,
      groupPublicName: 'tenant-a-group',
      ruleId: 'rule-a',
      classroomId: classroomA.id,
      machineId: 'machine-a',
      scheduleId: scheduleA.id,
      oneOffScheduleId: oneOffScheduleA.id,
      exemptionId: 'exemption-a',
      requestId: 'req-a',
      pendingUserId: 'pending-a',
      templateId,
      userId: teacherA.userId,
      userEmail: teacherA.email,
      invitationId: 'inv-a',
      operationId: 'op-a',
      pushEndpoint: 'https://push.tenant-a.test/ep-a',
    },
  };
}

async function seedTenantB(baseUrl: string): Promise<TenantBActor> {
  const scenario = createTenantScenario({ baseUrl, jwtSecret: TEST_JWT_SECRET });
  const { actor } = await scenario.createOrgAdmin({
    userId: 'tenant-b-admin',
    organizationName: 'Tenant B',
  });

  // Tenant B must own at least one classroom of its own so cases like
  // classrooms.listMachines reach the real per-classroomId isolation guard
  // (listTenantClassroomMachines short-circuits to `[]` when the caller org
  // owns zero classrooms, before that guard ever runs).
  const groupB = await scenario.createGroup({
    token: actor.token,
    name: 'tenant-b-group',
    displayName: 'Tenant B Group',
  });
  await scenario.createClassroom({
    token: actor.token,
    name: 'tenant-b-classroom',
    displayName: 'Tenant B Classroom',
    defaultGroupId: groupB.id,
  });

  return { token: actor.token };
}

/** Dispatch a registry case as tenant B, returning the parsed tRPC envelope. */
async function dispatchCase(
  baseUrl: string,
  path: string,
  input: unknown,
  token: string
): Promise<{ status: number; data?: unknown; error?: string; code?: string }> {
  const type = PROC_TYPE.get(path);
  assert.ok(type, `unknown procedure type for ${path}`);
  const response =
    type === 'query'
      ? await trpcQuery(baseUrl, path, input, bearerAuth(token))
      : await trpcMutate(baseUrl, path, input ?? {}, bearerAuth(token));
  const parsed = await parseTRPC(response);
  return { status: response.status, ...parsed };
}

let A: TenantAResources;
let B: TenantBActor;

void describe('cross-tenant isolation: reject cases', { concurrency: 1 }, () => {
  before(async () => {
    await resetDb();
    const seeded = await seedTenantA(integration.baseUrl);
    A = seeded.resources;
    B = await seedTenantB(integration.baseUrl);
  });

  const rejectEntries = Object.entries(CROSS_TENANT_CASES).filter(
    ([, kase]) => kase.kind === 'reject'
  );

  for (const [path, kase] of rejectEntries) {
    if (kase.kind !== 'reject') continue;
    void test(`${path} rejects tenant B with ${kase.code}`, async () => {
      const result = await dispatchCase(integration.baseUrl, path, kase.input(A), B.token);
      assert.ok(
        result.error,
        `${path}: expected a cross-tenant rejection but got 200 with data ${JSON.stringify(result.data)}`
      );
      assert.strictEqual(
        result.code,
        kase.code,
        `${path}: expected ${kase.code}, got ${result.code} (${result.error})`
      );
    });
  }
});
