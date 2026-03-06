/**
 * ClassroomPath schedules integration tests (/cp/trpc/schedules.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import {
  getAvailablePort,
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
  waitForHealth,
} from '../test-utils.js';

import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;
let server: Server | undefined;

type TestUser = {
  userId: string;
  email: string;
  name: string;
};

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

async function ensureOpenPathUser(u: TestUser): Promise<void> {
  await openpathDb
    .insert(openpathSchema.users)
    .values({
      id: u.userId,
      email: u.email,
      name: u.name,
      passwordHash: 'hashed',
    })
    .onConflictDoNothing();
}

async function bootstrapOrg(admin: { token: string }): Promise<{ organizationId: string }> {
  const createResp = await trpcMutate(
    API_URL,
    'onboarding.createOrganization',
    { name: 'Schedules Test Org' },
    bearerAuth(admin.token)
  );
  assertStatus(createResp, 200);
  const { data } = (await parseTRPC(createResp)) as { data: any };
  assert.ok(data?.organizationId, 'createOrganization should return organizationId');
  return { organizationId: String(data.organizationId) };
}

async function createGroup(user: { token: string }, name: string): Promise<{ groupId: string }> {
  const resp = await trpcMutate(
    API_URL,
    'groups.create',
    { name, displayName: name },
    bearerAuth(user.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'groups.create should return id');
  return { groupId: String(data.id) };
}

async function createClassroom(admin: { token: string }): Promise<{ classroomId: string }> {
  const resp = await trpcMutate(
    API_URL,
    'classrooms.create',
    { name: 'sched-test-classroom', displayName: 'Schedules Classroom' },
    bearerAuth(admin.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'classrooms.create should return id');
  return { classroomId: String(data.id) };
}

async function approveTeacher(params: {
  adminToken: string;
  teacherToken: string;
  teacherUserId: string;
  organizationId: string;
}): Promise<void> {
  const waitResp = await trpcMutate(
    API_URL,
    'onboarding.waitForInvitation',
    { targetOrganizationId: params.organizationId },
    bearerAuth(params.teacherToken)
  );
  assertStatus(waitResp, 200);

  const approveResp = await trpcMutate(
    API_URL,
    'pendingUsers.approve',
    { userId: params.teacherUserId, role: 'teacher' },
    bearerAuth(params.adminToken)
  );
  assertStatus(approveResp, 200);
}

describe('ClassroomPath schedules integration (/cp/trpc)', async () => {
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

    // Close undici keep-alives so node:test can exit cleanly.
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

  test('requires authentication + tenant membership', async () => {
    // No auth token -> UNAUTHORIZED
    const unauthResp = await trpcQuery(API_URL, 'schedules.getMine');
    const unauth = (await parseTRPC(unauthResp)) as any;
    assert.strictEqual(unauth.error, 'Not authenticated');

    // Auth token but no membership -> FORBIDDEN
    const userId = 'sched-no-membership';
    const email = uniqueEmail('nomembership');
    await ensureOpenPathUser({ userId, email, name: 'No Membership' });
    const token = signToken({ userId, email, name: 'No Membership', roles: [] });

    const resp = await trpcQuery(API_URL, 'schedules.getMine', undefined, bearerAuth(token));
    const parsed = (await parseTRPC(resp)) as any;
    assert.strictEqual(parsed.code, 'FORBIDDEN');
    assert.strictEqual(parsed.error, 'No organization membership found');
  });

  test('teacher can create schedule only for assigned group; getMine is tenant-scoped', async () => {
    await resetDb();

    // Admin creates org
    const adminUserId = 'sched-admin';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });
    const { organizationId } = await bootstrapOrg({ token: adminToken });

    const { groupId: adminGroupId } = await createGroup({ token: adminToken }, 'sched-admin-group');
    const { classroomId } = await createClassroom({ token: adminToken });

    // Teacher joins org
    const teacherUserId = 'sched-teacher';
    const teacherEmail = uniqueEmail('teacher');
    await ensureOpenPathUser({ userId: teacherUserId, email: teacherEmail, name: 'Teacher User' });
    const teacherTokenNoGroups = signToken({
      userId: teacherUserId,
      email: teacherEmail,
      name: 'Teacher User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherTokenNoGroups,
      teacherUserId,
      organizationId,
    });

    // Teacher cannot create schedule for group they are not assigned to
    const forbiddenCreate = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: adminGroupId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherTokenNoGroups)
    );
    const forbiddenJson = (await parseTRPC(forbiddenCreate)) as any;
    assert.strictEqual(forbiddenJson.code, 'FORBIDDEN');
    assert.strictEqual(
      forbiddenJson.error,
      'You can only create schedules for your assigned groups'
    );

    // Teacher creates their own group and can schedule with it
    const { groupId: teacherGroupId } = await createGroup(
      { token: teacherTokenNoGroups },
      'sched-teacher-group'
    );
    const createResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: teacherGroupId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherTokenNoGroups)
    );
    assertStatus(createResp, 200);
    const { data: created } = (await parseTRPC(createResp)) as { data: any };
    assert.ok(created?.id, 'create should return id');
    assert.strictEqual(created.teacherId, teacherUserId);

    // getMine should return only schedules within org classrooms
    const mineResp = await trpcQuery(
      API_URL,
      'schedules.getMine',
      undefined,
      bearerAuth(teacherTokenNoGroups)
    );
    assertStatus(mineResp, 200);
    const { data: mine } = (await parseTRPC(mineResp)) as { data: any[] };
    assert.ok(Array.isArray(mine));
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].id, created.id);
    assert.strictEqual(mine[0].classroomId, classroomId);
  });

  test('update/delete: owner-only unless admin token', async () => {
    await resetDb();

    // Admin creates org
    const adminUserId = 'sched-admin-2';
    const adminEmail = uniqueEmail('admin2');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User 2' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User 2',
      roles: [{ role: 'admin' }],
    });
    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    // Teacher A joins org, has group approval
    const teacherAId = 'sched-teacher-a';
    const teacherAEmail = uniqueEmail('teachera');
    await ensureOpenPathUser({ userId: teacherAId, email: teacherAEmail, name: 'Teacher A' });
    const teacherAToken = signToken({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher A',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherAToken,
      teacherUserId: teacherAId,
      organizationId,
    });

    const { groupId: groupAId } = await createGroup(
      { token: teacherAToken },
      'sched-teacher-a-group'
    );

    // Teacher B joins org, has group approval
    const teacherBId = 'sched-teacher-b';
    const teacherBEmail = uniqueEmail('teacherb');
    await ensureOpenPathUser({ userId: teacherBId, email: teacherBEmail, name: 'Teacher B' });
    const teacherBToken = signToken({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher B',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherBToken,
      teacherUserId: teacherBId,
      organizationId,
    });

    // Teacher A creates schedule
    const createResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: groupAId,
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(createResp, 200);
    const { data: sched } = (await parseTRPC(createResp)) as { data: any };

    // Teacher B cannot update A's schedule
    const updateResp = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: sched.id, startTime: '09:15' },
      bearerAuth(teacherBToken)
    );
    const updateJson = (await parseTRPC(updateResp)) as any;
    assert.strictEqual(updateJson.code, 'FORBIDDEN');
    assert.strictEqual(updateJson.error, 'You can only manage your own schedules');

    // Admin token can update any schedule
    const adminUpdateResp = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: sched.id, startTime: '09:15' },
      bearerAuth(adminToken)
    );
    assertStatus(adminUpdateResp, 200);

    // Teacher B cannot delete A's schedule
    const delResp = await trpcMutate(
      API_URL,
      'schedules.delete',
      { id: sched.id },
      bearerAuth(teacherBToken)
    );
    const delJson = (await parseTRPC(delResp)) as any;
    assert.strictEqual(delJson.code, 'FORBIDDEN');
    assert.strictEqual(delJson.error, 'You can only manage your own schedules');

    // Admin can delete
    const adminDelResp = await trpcMutate(
      API_URL,
      'schedules.delete',
      { id: sched.id },
      bearerAuth(adminToken)
    );
    assertStatus(adminDelResp, 200);
    const { data: delData } = (await parseTRPC(adminDelResp)) as { data: any };
    assert.deepStrictEqual(delData, { success: true });
  });

  test('getByClassroom returns weekly + one-off schedules with permissions; getMine excludes one-off', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff';
    const adminEmail = uniqueEmail('admin-oneoff');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin OneOff' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin OneOff',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherAId = 'sched-teacher-a-oneoff';
    const teacherAEmail = uniqueEmail('teachera-oneoff');
    await ensureOpenPathUser({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher A OneOff',
    });
    const teacherAToken = signToken({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher A OneOff',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherAToken,
      teacherUserId: teacherAId,
      organizationId,
    });
    const { groupId: groupAId } = await createGroup(
      { token: teacherAToken },
      'sched-teacher-a-oneoff-group'
    );

    const teacherBId = 'sched-teacher-b-oneoff';
    const teacherBEmail = uniqueEmail('teacherb-oneoff');
    await ensureOpenPathUser({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher B OneOff',
    });
    const teacherBToken = signToken({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher B OneOff',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherBToken,
      teacherUserId: teacherBId,
      organizationId,
    });
    const { groupId: groupBId } = await createGroup(
      { token: teacherBToken },
      'sched-teacher-b-oneoff-group'
    );

    const weeklyResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: groupAId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(weeklyResp, 200);
    const { data: weekly } = (await parseTRPC(weeklyResp)) as { data: any };
    assert.ok(weekly?.id, 'schedules.create should return id');

    const oneOffAResp = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId: groupAId,
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(oneOffAResp, 200);
    const { data: oneOffA } = (await parseTRPC(oneOffAResp)) as { data: any };
    assert.ok(oneOffA?.id, 'schedules.createOneOff should return id');

    const oneOffBResp = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId: groupBId,
        startAt: '2026-01-01T12:00:00Z',
        endAt: '2026-01-01T12:30:00Z',
      },
      bearerAuth(teacherBToken)
    );
    assertStatus(oneOffBResp, 200);
    const { data: oneOffB } = (await parseTRPC(oneOffBResp)) as { data: any };
    assert.ok(oneOffB?.id, 'schedules.createOneOff should return id');

    const byResp = await trpcQuery(
      API_URL,
      'schedules.getByClassroom',
      { classroomId },
      bearerAuth(teacherAToken)
    );
    assertStatus(byResp, 200);
    const { data } = (await parseTRPC(byResp)) as { data: any };
    assert.strictEqual(data?.classroom?.id, classroomId);
    assert.ok(Array.isArray(data?.schedules));
    assert.ok(Array.isArray(data?.oneOffSchedules));
    assert.strictEqual(data.schedules.length, 1);
    assert.strictEqual(data.oneOffSchedules.length, 2);

    const mineOneOff = data.oneOffSchedules.find((s: any) => s.id === oneOffA.id);
    assert.ok(mineOneOff);
    assert.strictEqual(mineOneOff.isMine, true);
    assert.strictEqual(mineOneOff.canEdit, true);

    const otherOneOff = data.oneOffSchedules.find((s: any) => s.id === oneOffB.id);
    assert.ok(otherOneOff);
    assert.strictEqual(otherOneOff.isMine, false);
    assert.strictEqual(otherOneOff.canEdit, false);

    const mineResp = await trpcQuery(
      API_URL,
      'schedules.getMine',
      undefined,
      bearerAuth(teacherAToken)
    );
    assertStatus(mineResp, 200);
    const { data: mine } = (await parseTRPC(mineResp)) as { data: any[] };
    assert.ok(Array.isArray(mine));
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0]?.id, weekly.id);
  });

  test('createOneOff validates dates and 15-minute instants', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff-validate';
    const adminEmail = uniqueEmail('admin-oneoff-validate');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Validate' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Validate',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-oneoff-validate';
    const teacherEmail = uniqueEmail('teacher-oneoff-validate');
    await ensureOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Teacher Validate' });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Validate',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup({ token: teacherToken }, 'sched-oneoff-validate-group');

    const invalidDate = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: 'not-a-date',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    const invalidDateJson = (await parseTRPC(invalidDate)) as any;
    assert.strictEqual(invalidDateJson.code, 'BAD_REQUEST');
    assert.match(String(invalidDateJson.error), /startAt.*valid date/i);

    const seconds = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:00:01Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    const secondsJson = (await parseTRPC(seconds)) as any;
    assert.strictEqual(secondsJson.code, 'BAD_REQUEST');
    assert.match(String(secondsJson.error), /startAt.*seconds/i);

    const nonQuarter = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:10:00Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    const nonQuarterJson = (await parseTRPC(nonQuarter)) as any;
    assert.strictEqual(nonQuarterJson.code, 'BAD_REQUEST');
    assert.match(String(nonQuarterJson.error), /15-minute increments/i);

    const invalidRange = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T10:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    const invalidRangeJson = (await parseTRPC(invalidRange)) as any;
    assert.strictEqual(invalidRangeJson.code, 'BAD_REQUEST');
    assert.match(String(invalidRangeJson.error), /endAt.*after startAt/i);
  });

  test('createOneOff rejects overlapping one-off schedules', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff-conflict';
    const adminEmail = uniqueEmail('admin-oneoff-conflict');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Conflict' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Conflict',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-oneoff-conflict';
    const teacherEmail = uniqueEmail('teacher-oneoff-conflict');
    await ensureOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Teacher Conflict' });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Conflict',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup({ token: teacherToken }, 'sched-oneoff-conflict-group');

    const first = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    assertStatus(first, 200);

    const overlap = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:30:00Z',
        endAt: '2026-01-01T11:30:00Z',
      },
      bearerAuth(teacherToken)
    );
    const overlapJson = (await parseTRPC(overlap)) as any;
    assert.strictEqual(overlapJson.code, 'CONFLICT');
    assert.match(String(overlapJson.error), /reservado/i);
  });

  test('updateOneOff enforces owner/admin and rejects weekly schedule IDs', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff-update';
    const adminEmail = uniqueEmail('admin-oneoff-update');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Update' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Update',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherAId = 'sched-teacher-oneoff-owner';
    const teacherAEmail = uniqueEmail('teacher-oneoff-owner');
    await ensureOpenPathUser({ userId: teacherAId, email: teacherAEmail, name: 'Teacher Owner' });
    const teacherAToken = signToken({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher Owner',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherAToken,
      teacherUserId: teacherAId,
      organizationId,
    });
    const { groupId: groupAId } = await createGroup(
      { token: teacherAToken },
      'sched-oneoff-owner-group'
    );

    const teacherBId = 'sched-teacher-oneoff-other';
    const teacherBEmail = uniqueEmail('teacher-oneoff-other');
    await ensureOpenPathUser({ userId: teacherBId, email: teacherBEmail, name: 'Teacher Other' });
    const teacherBToken = signToken({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher Other',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherBToken,
      teacherUserId: teacherBId,
      organizationId,
    });

    const createOneOffResp = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId: groupAId,
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(createOneOffResp, 200);
    const { data: oneOff } = (await parseTRPC(createOneOffResp)) as { data: any };

    const forbidden = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      { id: oneOff.id, groupId: groupAId },
      bearerAuth(teacherBToken)
    );
    const forbiddenJson = (await parseTRPC(forbidden)) as any;
    assert.strictEqual(forbiddenJson.code, 'FORBIDDEN');
    assert.match(String(forbiddenJson.error), /own schedules/i);

    const ownerUpdate = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      {
        id: oneOff.id,
        startAt: '2026-01-01T11:00:00Z',
        endAt: '2026-01-01T12:00:00Z',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(ownerUpdate, 200);

    const weeklyResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: groupAId,
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(weeklyResp, 200);
    const { data: weekly } = (await parseTRPC(weeklyResp)) as { data: any };

    const notOneOff = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      { id: weekly.id, groupId: groupAId },
      bearerAuth(adminToken)
    );
    const notOneOffJson = (await parseTRPC(notOneOff)) as any;
    assert.strictEqual(notOneOffJson.code, 'BAD_REQUEST');
    assert.match(String(notOneOffJson.error), /not one-off/i);
  });

  test('getMine returns [] when org has no classrooms', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-empty-mine';
    const adminEmail = uniqueEmail('admin-empty-mine');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Empty Mine' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Empty Mine',
      roles: [{ role: 'admin' }],
    });
    const { organizationId } = await bootstrapOrg({ token: adminToken });

    const teacherId = 'sched-teacher-empty-mine';
    const teacherEmail = uniqueEmail('teacher-empty-mine');
    await ensureOpenPathUser({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Empty Mine',
    });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Empty Mine',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });

    const mineResp = await trpcQuery(
      API_URL,
      'schedules.getMine',
      undefined,
      bearerAuth(teacherToken)
    );
    assertStatus(mineResp, 200);
    const { data: mine } = (await parseTRPC(mineResp)) as { data: any[] };
    assert.ok(Array.isArray(mine));
    assert.strictEqual(mine.length, 0);
  });

  test('unknown IDs return NOT_FOUND for update/updateOneOff/delete', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-unknown-ids';
    const adminEmail = uniqueEmail('admin-unknown-ids');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Unknown Ids' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Unknown Ids',
      roles: [{ role: 'admin' }],
    });
    await bootstrapOrg({ token: adminToken });

    const unknownId = '00000000-0000-0000-0000-000000000000';

    const updateResp = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: unknownId },
      bearerAuth(adminToken)
    );
    const updateJson = (await parseTRPC(updateResp)) as any;
    assert.strictEqual(updateJson.code, 'NOT_FOUND');
    assert.strictEqual(updateJson.error, 'Schedule not found');

    const updateOneOffResp = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      { id: unknownId },
      bearerAuth(adminToken)
    );
    const updateOneOffJson = (await parseTRPC(updateOneOffResp)) as any;
    assert.strictEqual(updateOneOffJson.code, 'NOT_FOUND');
    assert.strictEqual(updateOneOffJson.error, 'Schedule not found');

    const deleteResp = await trpcMutate(
      API_URL,
      'schedules.delete',
      { id: unknownId },
      bearerAuth(adminToken)
    );
    const deleteJson = (await parseTRPC(deleteResp)) as any;
    assert.strictEqual(deleteJson.code, 'NOT_FOUND');
    assert.strictEqual(deleteJson.error, 'Schedule not found');
  });

  test('weekly update rejects startTime >= endTime', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-weekly-invalid-window';
    const adminEmail = uniqueEmail('admin-weekly-invalid-window');
    await ensureOpenPathUser({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Weekly Invalid Window',
    });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Weekly Invalid Window',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-weekly-invalid-window';
    const teacherEmail = uniqueEmail('teacher-weekly-invalid-window');
    await ensureOpenPathUser({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Weekly Invalid Window',
    });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Weekly Invalid Window',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup(
      { token: teacherToken },
      'sched-weekly-invalid-window-group'
    );

    const createResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
      },
      bearerAuth(teacherToken)
    );
    assertStatus(createResp, 200);
    const { data: sched } = (await parseTRPC(createResp)) as { data: any };
    assert.ok(sched?.id);

    const invalidUpdate = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: sched.id, endTime: '08:45' },
      bearerAuth(teacherToken)
    );
    const invalidUpdateJson = (await parseTRPC(invalidUpdate)) as any;
    assert.strictEqual(invalidUpdateJson.code, 'BAD_REQUEST');
    assert.match(String(invalidUpdateJson.error), /startTime must be before endTime/i);
  });

  test('weekly update forbids changing groupId to an unassigned group', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-weekly-group-change';
    const adminEmail = uniqueEmail('admin-weekly-group-change');
    await ensureOpenPathUser({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Weekly Group Change',
    });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Weekly Group Change',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherAId = 'sched-teacher-weekly-group-change-a';
    const teacherAEmail = uniqueEmail('teacher-weekly-group-change-a');
    await ensureOpenPathUser({ userId: teacherAId, email: teacherAEmail, name: 'Teacher Group A' });
    const teacherAToken = signToken({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher Group A',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherAToken,
      teacherUserId: teacherAId,
      organizationId,
    });
    const { groupId: groupAId } = await createGroup(
      { token: teacherAToken },
      'sched-weekly-group-change-group-a'
    );

    const teacherBId = 'sched-teacher-weekly-group-change-b';
    const teacherBEmail = uniqueEmail('teacher-weekly-group-change-b');
    await ensureOpenPathUser({ userId: teacherBId, email: teacherBEmail, name: 'Teacher Group B' });
    const teacherBToken = signToken({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher Group B',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherBToken,
      teacherUserId: teacherBId,
      organizationId,
    });
    const { groupId: groupBId } = await createGroup(
      { token: teacherBToken },
      'sched-weekly-group-change-group-b'
    );

    const createResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId: groupAId,
        dayOfWeek: 3,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherAToken)
    );
    assertStatus(createResp, 200);
    const { data: sched } = (await parseTRPC(createResp)) as { data: any };
    assert.ok(sched?.id);

    const forbiddenUpdate = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: sched.id, groupId: groupBId },
      bearerAuth(teacherAToken)
    );
    const forbiddenJson = (await parseTRPC(forbiddenUpdate)) as any;
    assert.strictEqual(forbiddenJson.code, 'FORBIDDEN');
    assert.strictEqual(
      forbiddenJson.error,
      'You can only create schedules for your assigned groups'
    );
  });

  test('updateOneOff rejects endAt <= startAt', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff-invalid-range';
    const adminEmail = uniqueEmail('admin-oneoff-invalid-range');
    await ensureOpenPathUser({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin OneOff Invalid Range',
    });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin OneOff Invalid Range',
      roles: [{ role: 'admin' }],
    });
    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-oneoff-invalid-range';
    const teacherEmail = uniqueEmail('teacher-oneoff-invalid-range');
    await ensureOpenPathUser({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher OneOff Invalid Range',
    });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher OneOff Invalid Range',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup(
      { token: teacherToken },
      'sched-oneoff-invalid-range-group'
    );

    const createOneOffResp = await trpcMutate(
      API_URL,
      'schedules.createOneOff',
      {
        classroomId,
        groupId,
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T11:00:00Z',
      },
      bearerAuth(teacherToken)
    );
    assertStatus(createOneOffResp, 200);
    const { data: oneOff } = (await parseTRPC(createOneOffResp)) as { data: any };
    assert.ok(oneOff?.id);

    const invalidUpdate = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      { id: oneOff.id, endAt: '2026-01-01T09:00:00Z' },
      bearerAuth(teacherToken)
    );
    const invalidUpdateJson = (await parseTRPC(invalidUpdate)) as any;
    assert.strictEqual(invalidUpdateJson.code, 'BAD_REQUEST');
    assert.match(String(invalidUpdateJson.error), /endAt.*after startAt/i);
  });

  test('getByClassroom returns NOT_FOUND if OpenPath classroom row is missing', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-classroom-missing';
    const adminEmail = uniqueEmail('admin-classroom-missing');
    await ensureOpenPathUser({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Classroom Missing',
    });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Classroom Missing',
      roles: [{ role: 'admin' }],
    });
    await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, classroomId));

    const byResp = await trpcQuery(
      API_URL,
      'schedules.getByClassroom',
      { classroomId },
      bearerAuth(adminToken)
    );
    const byJson = (await parseTRPC(byResp)) as any;
    assert.strictEqual(byJson.code, 'NOT_FOUND');
    assert.strictEqual(byJson.error, 'Classroom not found');
  });

  test('updateOneOff rejects corrupted one-off schedules (null startAt/endAt)', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-oneoff-corrupt';
    const adminEmail = uniqueEmail('admin-oneoff-corrupt');
    await ensureOpenPathUser({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin OneOff Corrupt',
    });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin OneOff Corrupt',
      roles: [{ role: 'admin' }],
    });
    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-oneoff-corrupt';
    const teacherEmail = uniqueEmail('teacher-oneoff-corrupt');
    await ensureOpenPathUser({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher OneOff Corrupt',
    });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher OneOff Corrupt',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup({ token: teacherToken }, 'sched-oneoff-corrupt-group');

    const [corrupt] = await openpathDb
      .insert(openpathSchema.schedules)
      .values({
        classroomId,
        teacherId,
        groupId,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        startAt: null,
        endAt: null,
        recurrence: 'one_off',
      })
      .returning();

    const resp = await trpcMutate(
      API_URL,
      'schedules.updateOneOff',
      { id: corrupt.id, groupId },
      bearerAuth(teacherToken)
    );
    const json = (await parseTRPC(resp)) as any;
    assert.strictEqual(json.code, 'BAD_REQUEST');
    assert.match(String(json.error), /invalid one-off/i);
  });

  test('weekly create/update rejects overlaps and invalid time windows', async () => {
    await resetDb();

    const adminUserId = 'sched-admin-weekly-conflict';
    const adminEmail = uniqueEmail('admin-weekly-conflict');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin Weekly' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Weekly',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    const teacherId = 'sched-teacher-weekly-conflict';
    const teacherEmail = uniqueEmail('teacher-weekly-conflict');
    await ensureOpenPathUser({ userId: teacherId, email: teacherEmail, name: 'Teacher Weekly' });
    const teacherToken = signToken({
      userId: teacherId,
      email: teacherEmail,
      name: 'Teacher Weekly',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId: teacherId,
      organizationId,
    });
    const { groupId } = await createGroup({ token: teacherToken }, 'sched-weekly-conflict-group');

    const invalidQuarter = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '10:07',
        endTime: '11:00',
      },
      bearerAuth(teacherToken)
    );
    const invalidQuarterJson = (await parseTRPC(invalidQuarter)) as any;
    assert.strictEqual(invalidQuarterJson.code, 'BAD_REQUEST');
    assert.match(String(invalidQuarterJson.error), /15-minute increments/i);

    const invalidWindow = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '10:00',
      },
      bearerAuth(teacherToken)
    );
    const invalidWindowJson = (await parseTRPC(invalidWindow)) as any;
    assert.strictEqual(invalidWindowJson.code, 'BAD_REQUEST');
    assert.match(String(invalidWindowJson.error), /startTime must be before endTime/i);

    const first = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherToken)
    );
    assertStatus(first, 200);
    const { data: schedA } = (await parseTRPC(first)) as { data: any };

    const overlap = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '10:30',
        endTime: '11:30',
      },
      bearerAuth(teacherToken)
    );
    const overlapJson = (await parseTRPC(overlap)) as any;
    assert.strictEqual(overlapJson.code, 'CONFLICT');
    assert.match(String(overlapJson.error), /reservado/i);

    const second = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '11:00',
        endTime: '12:00',
      },
      bearerAuth(teacherToken)
    );
    assertStatus(second, 200);
    const { data: schedB } = (await parseTRPC(second)) as { data: any };

    const updateOverlap = await trpcMutate(
      API_URL,
      'schedules.update',
      { id: schedB.id, startTime: '10:30' },
      bearerAuth(teacherToken)
    );
    const updateOverlapJson = (await parseTRPC(updateOverlap)) as any;
    assert.strictEqual(updateOverlapJson.code, 'CONFLICT');
    assert.match(String(updateOverlapJson.error), /reservado/i);

    // Keep schedA referenced to avoid eslint unused in strict configs.
    assert.ok(schedA.id);
  });
});
