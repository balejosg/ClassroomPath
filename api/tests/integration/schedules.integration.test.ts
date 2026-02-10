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

import {
  getAvailablePort,
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
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

async function createGroup(admin: { token: string }): Promise<{ groupId: string }> {
  const resp = await trpcMutate(
    API_URL,
    'groups.create',
    { name: 'sched-test-group', displayName: 'Schedules Group' },
    bearerAuth(admin.token)
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

    const { groupId } = await createGroup({ token: adminToken });
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
        groupId,
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

    // Now give teacher an approval role for that group
    const teacherTokenWithGroup = signToken({
      userId: teacherUserId,
      email: teacherEmail,
      name: 'Teacher User',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });

    const createResp = await trpcMutate(
      API_URL,
      'schedules.create',
      {
        classroomId,
        groupId,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '11:00',
      },
      bearerAuth(teacherTokenWithGroup)
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
      bearerAuth(teacherTokenWithGroup)
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
    const { groupId } = await createGroup({ token: adminToken });
    const { classroomId } = await createClassroom({ token: adminToken });

    // Teacher A joins org, has group approval
    const teacherAId = 'sched-teacher-a';
    const teacherAEmail = uniqueEmail('teachera');
    await ensureOpenPathUser({ userId: teacherAId, email: teacherAEmail, name: 'Teacher A' });
    const teacherAToken = signToken({
      userId: teacherAId,
      email: teacherAEmail,
      name: 'Teacher A',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
    });
    await approveTeacher({
      adminToken,
      teacherToken: teacherAToken,
      teacherUserId: teacherAId,
      organizationId,
    });

    // Teacher B joins org, has group approval
    const teacherBId = 'sched-teacher-b';
    const teacherBEmail = uniqueEmail('teacherb');
    await ensureOpenPathUser({ userId: teacherBId, email: teacherBEmail, name: 'Teacher B' });
    const teacherBToken = signToken({
      userId: teacherBId,
      email: teacherBEmail,
      name: 'Teacher B',
      roles: [{ role: 'teacher', groupIds: [groupId] }],
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
        groupId,
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
});
