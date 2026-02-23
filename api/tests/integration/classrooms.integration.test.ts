/**
 * ClassroomPath classrooms integration tests (/cp/trpc/classrooms.*)
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
import { db, closeConnection } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
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
    { name: 'Classrooms Test Org' },
    bearerAuth(admin.token)
  );
  assertStatus(createResp, 200);
  const { data } = (await parseTRPC(createResp)) as { data: any };
  assert.ok(data?.organizationId, 'createOrganization should return organizationId');
  return { organizationId: String(data.organizationId) };
}

async function createGroup(admin: { token: string }, name: string): Promise<{ groupId: string }> {
  const resp = await trpcMutate(
    API_URL,
    'groups.create',
    { name, displayName: name },
    bearerAuth(admin.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'groups.create should return id');
  return { groupId: String(data.id) };
}

async function createClassroom(
  admin: { token: string },
  params: { defaultGroupId?: string; name?: string; displayName?: string }
): Promise<{
  classroomId: string;
}> {
  const name = params.name ?? 'classrooms-test-classroom';
  const displayName = params.displayName ?? 'Classrooms Classroom';

  const resp = await trpcMutate(
    API_URL,
    'classrooms.create',
    { name, displayName, defaultGroupId: params.defaultGroupId },
    bearerAuth(admin.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'classrooms.create should return id');
  return { classroomId: String(data.id) };
}

async function approveOrgMember(params: {
  adminToken: string;
  memberToken: string;
  memberUserId: string;
  organizationId: string;
  role: 'teacher';
}): Promise<void> {
  const waitResp = await trpcMutate(
    API_URL,
    'onboarding.waitForInvitation',
    { targetOrganizationId: params.organizationId },
    bearerAuth(params.memberToken)
  );
  assertStatus(waitResp, 200);

  const approveResp = await trpcMutate(
    API_URL,
    'pendingUsers.approve',
    { userId: params.memberUserId, role: params.role },
    bearerAuth(params.adminToken)
  );
  assertStatus(approveResp, 200);
}

function withMockedDate<T>(date: Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = date;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = class extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed.getTime());
      else super(...(args as any));
    }

    static now(): number {
      return fixed.getTime();
    }

    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  };

  return fn().finally(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = RealDate;
  });
}

describe('ClassroomPath classrooms integration (/cp/trpc)', async () => {
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

  test('classrooms.list/getById include currentGroupId from schedule (or default)', async () => {
    await resetDb();

    const adminUserId = 'classrooms-admin';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminToken });

    const { groupId: defaultGroupId } = await createGroup({ token: adminToken }, 'default-group');
    const { groupId: scheduledGroupId } = await createGroup(
      { token: adminToken },
      'scheduled-group'
    );
    const { classroomId } = await createClassroom({ token: adminToken }, { defaultGroupId });

    // Fixed local time: Tuesday 10:30 -> should match schedule dayOfWeek=2 (Tue)
    const inSlot = new Date(2026, 1, 3, 10, 30, 0, 0);
    await withMockedDate(inSlot, async () => {
      const createSchedule = await trpcMutate(
        API_URL,
        'schedules.create',
        {
          classroomId,
          groupId: scheduledGroupId,
          dayOfWeek: 2,
          startTime: '10:00',
          endTime: '11:00',
        },
        bearerAuth(adminToken)
      );
      assertStatus(createSchedule, 200);

      const listResp = await trpcQuery(
        API_URL,
        'classrooms.list',
        undefined,
        bearerAuth(adminToken)
      );
      assertStatus(listResp, 200);
      const { data: list } = (await parseTRPC(listResp)) as { data: any[] };
      const row = list.find((c) => c.id === classroomId);
      assert.ok(row, 'classroom should be in list');
      assert.strictEqual(row.defaultGroupId, defaultGroupId);
      assert.strictEqual(row.activeGroupId, null);
      assert.strictEqual(row.currentGroupId, scheduledGroupId);
      assert.strictEqual(row.currentGroupSource, 'schedule');

      const getResp = await trpcQuery(
        API_URL,
        'classrooms.getById',
        { id: classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(getResp, 200);
      const { data: got } = (await parseTRPC(getResp)) as { data: any };
      assert.strictEqual(got.id, classroomId);
      assert.strictEqual(got.currentGroupId, scheduledGroupId);
      assert.strictEqual(got.currentGroupSource, 'schedule');
    });

    // Outside the slot -> fallback to default group
    const outOfSlot = new Date(2026, 1, 3, 12, 0, 0, 0);
    await withMockedDate(outOfSlot, async () => {
      const getResp = await trpcQuery(
        API_URL,
        'classrooms.getById',
        { id: classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(getResp, 200);
      const { data: got } = (await parseTRPC(getResp)) as { data: any };
      assert.strictEqual(got.currentGroupId, defaultGroupId);
      assert.strictEqual(got.currentGroupSource, 'default');
    });
  });

  test('allows same classroom name in different organizations but blocks duplicates in same org', async () => {
    await resetDb();

    const sharedClassroomName = 'Laboratorio C';

    const adminAUserId = 'classrooms-admin-a';
    const adminAEmail = uniqueEmail('admin-a');
    await ensureOpenPathUser({ userId: adminAUserId, email: adminAEmail, name: 'Admin A' });
    const adminAToken = signToken({
      userId: adminAUserId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminAToken });

    const createA1 = await trpcMutate(
      API_URL,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminAToken)
    );
    assertStatus(createA1, 200);
    const { data: classroomA1 } = (await parseTRPC(createA1)) as { data: any };
    assert.ok(classroomA1?.id);

    const createA2Duplicate = await trpcMutate(
      API_URL,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminAToken)
    );
    assertStatus(createA2Duplicate, 409);

    const adminBUserId = 'classrooms-admin-b';
    const adminBEmail = uniqueEmail('admin-b');
    await ensureOpenPathUser({ userId: adminBUserId, email: adminBEmail, name: 'Admin B' });
    const adminBToken = signToken({
      userId: adminBUserId,
      email: adminBEmail,
      name: 'Admin B',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminBToken });

    const createB1 = await trpcMutate(
      API_URL,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminBToken)
    );
    assertStatus(createB1, 200);
    const { data: classroomB1 } = (await parseTRPC(createB1)) as { data: any };
    assert.ok(classroomB1?.id);
    assert.notStrictEqual(String(classroomA1.id), String(classroomB1.id));

    const listAResp = await trpcQuery(
      API_URL,
      'classrooms.list',
      undefined,
      bearerAuth(adminAToken)
    );
    assertStatus(listAResp, 200);
    const { data: listA } = (await parseTRPC(listAResp)) as { data: any[] };
    assert.strictEqual(listA.length, 1);
    assert.strictEqual(String(listA[0].id), String(classroomA1.id));
    assert.strictEqual(String(listA[0].name), sharedClassroomName);

    const listBResp = await trpcQuery(
      API_URL,
      'classrooms.list',
      undefined,
      bearerAuth(adminBToken)
    );
    assertStatus(listBResp, 200);
    const { data: listB } = (await parseTRPC(listBResp)) as { data: any[] };
    assert.strictEqual(listB.length, 1);
    assert.strictEqual(String(listB[0].id), String(classroomB1.id));
    assert.strictEqual(String(listB[0].name), sharedClassroomName);

    const dbClassrooms = await openpathDb.select().from(openpathSchema.classrooms);
    const rowA = dbClassrooms.find((c) => c.id === String(classroomA1.id));
    const rowB = dbClassrooms.find((c) => c.id === String(classroomB1.id));
    assert.ok(rowA);
    assert.ok(rowB);
    assert.notStrictEqual(rowA?.name, rowB?.name);
  });

  test('groups.update accepts boolean enabled payload from OpenPath UI', async () => {
    await resetDb();

    const adminUserId = 'groups-update-admin';
    const adminEmail = uniqueEmail('admin-groups-update');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminToken });
    const { groupId } = await createGroup({ token: adminToken }, 'groups-update-target');

    const disableResp = await trpcMutate(
      API_URL,
      'groups.update',
      {
        id: groupId,
        displayName: 'Groups Update Target',
        enabled: false,
      },
      bearerAuth(adminToken)
    );

    assertStatus(disableResp, 200);
    const disableData = (await parseTRPC(disableResp)) as { data: any };
    assert.strictEqual(disableData.data.id, groupId);
    assert.strictEqual(Number(disableData.data.enabled), 0);

    const enableResp = await trpcMutate(
      API_URL,
      'groups.update',
      {
        id: groupId,
        displayName: 'Groups Update Target',
        enabled: true,
      },
      bearerAuth(adminToken)
    );

    assertStatus(enableResp, 200);
    const enableData = (await parseTRPC(enableResp)) as { data: any };
    assert.strictEqual(enableData.data.id, groupId);
    assert.strictEqual(Number(enableData.data.enabled), 1);
  });

  test('groups.delete does not delete group when shared across organizations', async () => {
    await resetDb();

    const adminAUserId = 'groups-delete-admin-a';
    const adminAEmail = uniqueEmail('gda');
    await ensureOpenPathUser({ userId: adminAUserId, email: adminAEmail, name: 'Admin A' });
    const adminAToken = signToken({
      userId: adminAUserId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin' }],
    });
    await bootstrapOrg({ token: adminAToken });

    const adminBUserId = 'groups-delete-admin-b';
    const adminBEmail = uniqueEmail('gdb');
    await ensureOpenPathUser({ userId: adminBUserId, email: adminBEmail, name: 'Admin B' });
    const adminBToken = signToken({
      userId: adminBUserId,
      email: adminBEmail,
      name: 'Admin B',
      roles: [{ role: 'admin' }],
    });
    const { organizationId: orgB } = await bootstrapOrg({ token: adminBToken });

    const { groupId } = await createGroup({ token: adminAToken }, 'shared-group-delete-test');

    // Simulate an accidental/shared link: same whitelist group linked to a second org.
    await db.insert(cpSchema.cpOrganizationGroups).values({
      id: `og-b-${groupId}`,
      organizationId: orgB,
      groupId,
    });

    const deleteResp = await trpcMutate(
      API_URL,
      'groups.delete',
      { id: groupId },
      bearerAuth(adminAToken)
    );
    assertStatus(deleteResp, 200);

    const getResp = await trpcQuery(
      API_URL,
      'groups.getById',
      { id: groupId },
      bearerAuth(adminBToken)
    );
    assertStatus(getResp, 200);
    const { data: got } = (await parseTRPC(getResp)) as { data: any };
    assert.ok(got, 'group should still exist for other org');
    assert.strictEqual(String(got.id), groupId);
  });

  test('classrooms.update enforces teacher group ownership for defaultGroupId', async () => {
    await resetDb();

    const adminUserId = 'classrooms-admin-perms';
    const adminEmail = uniqueEmail('admin-perms');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });

    const { groupId: adminGroupId } = await createGroup({ token: adminToken }, 'admin-owned-group');
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'perms-classroom', displayName: 'Perms Classroom' }
    );

    const teacherUserId = 'classrooms-teacher-perms';
    const teacherEmail = uniqueEmail('teacher-perms');
    await ensureOpenPathUser({ userId: teacherUserId, email: teacherEmail, name: 'Teacher User' });
    const teacherToken = signToken({
      userId: teacherUserId,
      email: teacherEmail,
      name: 'Teacher User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveOrgMember({
      adminToken,
      memberToken: teacherToken,
      memberUserId: teacherUserId,
      organizationId,
      role: 'teacher',
    });

    const forbiddenDefault = await trpcMutate(
      API_URL,
      'classrooms.update',
      { id: classroomId, defaultGroupId: adminGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(forbiddenDefault, 403);

    const teacherGroupResp = await trpcMutate(
      API_URL,
      'groups.create',
      { name: 'teacher-owned-group', displayName: 'Teacher Owned Group' },
      bearerAuth(teacherToken)
    );
    assertStatus(teacherGroupResp, 200);
    const { data: teacherGroup } = (await parseTRPC(teacherGroupResp)) as { data: any };
    assert.ok(teacherGroup?.id, 'groups.create should return id');
    const teacherGroupId = String(teacherGroup.id);

    const allowedDefault = await trpcMutate(
      API_URL,
      'classrooms.update',
      { id: classroomId, defaultGroupId: teacherGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(allowedDefault, 200);
    const { data: updated } = (await parseTRPC(allowedDefault)) as { data: any };
    assert.strictEqual(updated.defaultGroupId, teacherGroupId);
  });
});
