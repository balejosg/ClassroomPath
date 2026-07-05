import { TEST_JWT_SECRET } from '../helpers/test-env.js';

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

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

interface DispatchResult {
  status: number;
  data?: unknown;
  error?: string;
  code?: string;
}

/** Dispatch a registry case as tenant B, returning the parsed tRPC envelope. */
async function dispatchCase(
  baseUrl: string,
  path: string,
  input: unknown,
  token: string
): Promise<DispatchResult> {
  const type = PROC_TYPE.get(path);
  assert.ok(type, `unknown procedure type for ${path}`);
  const response =
    type === 'query'
      ? await trpcQuery(baseUrl, path, input, bearerAuth(token))
      : await trpcMutate(baseUrl, path, input ?? {}, bearerAuth(token));
  const parsed = await parseTRPC(response);
  return { status: response.status, ...parsed };
}

/**
 * Shared assertion for "this call must be rejected as cross-tenant". Used by
 * both the real 46-case reject loop and the harness self-check, so the
 * self-check exercises the exact same assertion code path rather than a
 * hand-copied mirror of it.
 */
function assertRejected(result: DispatchResult, path: string, expectedCode: string): void {
  assert.ok(
    result.error,
    `${path}: expected a cross-tenant rejection but got 200 with data ${JSON.stringify(result.data)}`
  );
  assert.strictEqual(
    result.code,
    expectedCode,
    `${path}: expected ${expectedCode}, got ${result.code} (${result.error})`
  );
}

/** Assert none of tenant A's identifiers appear anywhere in a scoped result. */
function assertNoTenantALeak(path: string, data: unknown, a: TenantAResources): void {
  const needles = [
    a.groupId,
    a.ruleId,
    a.classroomId,
    a.machineId,
    a.scheduleId,
    a.oneOffScheduleId,
    a.exemptionId,
    a.requestId,
    a.invitationId,
    a.operationId,
    a.userId,
    a.pendingUserId,
    a.pushEndpoint,
    a.orgId,
    // a.templateId is deliberately NOT a needle: templates are an intentional
    // global shared catalog (ADR 0003), so a template id can legitimately
    // appear in a cross-tenant caller's scoped result.
  ];
  const haystack = JSON.stringify(data ?? null);
  for (const needle of needles) {
    assert.ok(
      !haystack.includes(needle),
      `${path}: scoped result leaked tenant A identifier ${needle}: ${haystack}`
    );
  }
}

/**
 * A before/after snapshot of every tenant-A-owned row-set touched (directly
 * or indirectly) by one of the 6 scoped mutations. Each mutation's real
 * write table is represented so a cross-tenant leak into tenant A's data
 * would show up as a snapshot diff, not just a missing existence check:
 *
 * - groups.create        -> cpOrganizationGroups (orgGroupIds)
 * - classrooms.create     -> cpOrganizationClassrooms (orgClassroomIds)
 * - templates.import      -> whitelistRules under group A (ruleIds)
 * - users.create           -> cpMemberships for org A (memberships)
 * - pendingUsers.reject    -> cpUserStatus for pending-a (pendingStatus)
 * - push.unsubscribe       -> pushSubscriptions for the endpoint (pushSub)
 */
interface TenantASnapshot {
  group: unknown[];
  ruleIds: string[];
  request: unknown[];
  pendingStatus: unknown[];
  pushSub: unknown[];
  orgGroupIds: string[];
  orgClassroomIds: string[];
  memberships: unknown[];
}

async function captureTenantASnapshot(a: TenantAResources): Promise<TenantASnapshot> {
  const group = await openpathDb
    .select()
    .from(openpathSchema.whitelistGroups)
    .where(eq(openpathSchema.whitelistGroups.id, a.groupId));

  const rules = await openpathDb
    .select({ id: openpathSchema.whitelistRules.id })
    .from(openpathSchema.whitelistRules)
    .where(eq(openpathSchema.whitelistRules.groupId, a.groupId));
  const ruleIds = rules.map((r) => r.id).sort();

  const request = await openpathDb
    .select()
    .from(openpathSchema.requests)
    .where(eq(openpathSchema.requests.id, a.requestId));

  const pendingStatus = await db
    .select()
    .from(cpSchema.cpUserStatus)
    .where(eq(cpSchema.cpUserStatus.userId, a.pendingUserId));

  const pushSub = await openpathDb
    .select()
    .from(openpathSchema.pushSubscriptions)
    .where(eq(openpathSchema.pushSubscriptions.endpoint, a.pushEndpoint));

  const orgGroups = await db
    .select({ groupId: cpSchema.cpOrganizationGroups.groupId })
    .from(cpSchema.cpOrganizationGroups)
    .where(eq(cpSchema.cpOrganizationGroups.organizationId, a.orgId));
  const orgGroupIds = orgGroups.map((g) => g.groupId).sort();

  const orgClassrooms = await db
    .select({ classroomId: cpSchema.cpOrganizationClassrooms.classroomId })
    .from(cpSchema.cpOrganizationClassrooms)
    .where(eq(cpSchema.cpOrganizationClassrooms.organizationId, a.orgId));
  const orgClassroomIds = orgClassrooms.map((c) => c.classroomId).sort();

  const memberships = await db
    .select()
    .from(cpSchema.cpMemberships)
    .where(eq(cpSchema.cpMemberships.organizationId, a.orgId))
    .orderBy(cpSchema.cpMemberships.id);

  return {
    group,
    ruleIds,
    request,
    pendingStatus,
    pushSub,
    orgGroupIds,
    orgClassroomIds,
    memberships,
  };
}

/**
 * Verify every tenant A row-set covered by `captureTenantASnapshot` is
 * byte-for-byte unchanged after tenant B's scoped mutations, by re-reading
 * the same sets and deep-comparing them against the pre-mutation baseline.
 */
async function assertTenantAUnchanged(
  a: TenantAResources,
  baseline: TenantASnapshot
): Promise<void> {
  const after = await captureTenantASnapshot(a);

  assert.deepStrictEqual(after.group, baseline.group, 'tenant A whitelist group row changed');
  assert.deepStrictEqual(
    after.ruleIds,
    baseline.ruleIds,
    'tenant A group rule id set changed (templates.import may have leaked rules into group A)'
  );
  assert.deepStrictEqual(after.request, baseline.request, 'tenant A request row changed');
  assert.deepStrictEqual(
    after.pendingStatus,
    baseline.pendingStatus,
    'tenant A pending-user status row changed (cross-org pendingUsers.reject was not a no-op)'
  );
  assert.deepStrictEqual(
    after.pushSub,
    baseline.pushSub,
    'tenant A push subscription row changed (cross-user push.unsubscribe was not a no-op)'
  );
  assert.deepStrictEqual(
    after.orgGroupIds,
    baseline.orgGroupIds,
    'tenant A org-group link set changed (groups.create may have attributed a group to org A)'
  );
  assert.deepStrictEqual(
    after.orgClassroomIds,
    baseline.orgClassroomIds,
    'tenant A org-classroom link set changed (classrooms.create may have attributed a classroom to org A)'
  );
  assert.deepStrictEqual(
    after.memberships,
    baseline.memberships,
    'tenant A membership rows changed (users.create may have attributed a membership to org A)'
  );
}

let A: TenantAResources;
let B: TenantBActor;
/** Baseline snapshot of tenant A, captured right after seeding and before any
 * of tenant B's scoped mutations run. Populated in the scoped-cases describe's
 * `before()`; read by the final sweep test in the same describe. */
let tenantABaseline: TenantASnapshot;

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
      assertRejected(result, path, kase.code);
    });
  }
});

void describe('cross-tenant isolation: scoped cases + unchanged sweep', { concurrency: 1 }, () => {
  before(async () => {
    await resetDb();
    const seeded = await seedTenantA(integration.baseUrl);
    A = seeded.resources;
    B = await seedTenantB(integration.baseUrl);
    // Snapshot baseline BEFORE any of tenant B's scoped mutations run below.
    tenantABaseline = await captureTenantASnapshot(A);
  });

  const scopedEntries = Object.entries(CROSS_TENANT_CASES).filter(
    ([, kase]) => kase.kind === 'scoped'
  );

  for (const [path, kase] of scopedEntries) {
    if (kase.kind !== 'scoped') continue;
    void test(`${path} returns 200 for tenant B without leaking tenant A (${kase.note})`, async () => {
      const result = await dispatchCase(integration.baseUrl, path, kase.input(A), B.token);
      assert.strictEqual(
        result.status,
        200,
        `${path}: expected 200, got ${result.status} (${result.error ?? ''})`
      );
      assert.ok(!result.error, `${path}: unexpected error ${result.error}`);
      assertNoTenantALeak(path, result.data, A);
    });
  }

  void test('tenant A is unchanged after all tenant B scoped mutations', async () => {
    await assertTenantAUnchanged(A, tenantABaseline);
  });
});

void describe('cross-tenant isolation: harness self-check', { concurrency: 1 }, () => {
  before(async () => {
    await resetDb();
    const seeded = await seedTenantA(integration.baseUrl);
    A = seeded.resources;
    B = await seedTenantB(integration.baseUrl);
  });

  void test('a scoped list procedure misclassified as reject is caught by the runner', async () => {
    // groups.list returns 200 with the caller org's (empty) list. If we WRONGLY
    // asserted it must reject, the reject assertion must fail. This proves the
    // reject-execution logic in Task 3 has teeth (guards against a future change
    // that makes every call silently pass). Calls the SAME assertRejected used
    // by the real reject loop above, not a hand-copied mirror of it.
    const result = await dispatchCase(integration.baseUrl, 'groups.list', undefined, B.token);
    assert.strictEqual(result.status, 200, 'precondition: groups.list is a scoped 200');

    assert.throws(
      () => assertRejected(result, 'groups.list', 'NOT_FOUND'),
      /expected a cross-tenant rejection/,
      'the reject assertion should fail loudly for a non-rejecting procedure'
    );
  });
});
