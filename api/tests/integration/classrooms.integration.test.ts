/**
 * ClassroomPath classrooms integration tests (/cp/trpc/classrooms.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import {
  bootstrapOrg,
  ensureOpenPathUser,
  signToken,
  approveOrganizationMember,
  useIntegrationServer,
} from './harness.js';
import { createTenantScenario, withFrozenDate } from './scenario-builder.js';

import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

function buildScenario() {
  return createTenantScenario({ baseUrl: integration.baseUrl, jwtSecret: JWT_SECRET });
}

async function createGroup(admin: { token: string }, name: string): Promise<{ groupId: string }> {
  const scenario = buildScenario();
  const group = await scenario.createGroup({ token: admin.token, name });
  return { groupId: group.id };
}

async function createClassroom(
  admin: { token: string },
  params: { defaultGroupId?: string; name?: string; displayName?: string }
): Promise<{
  classroomId: string;
}> {
  const scenario = buildScenario();
  const classroom = await scenario.createClassroom({
    token: admin.token,
    name: params.name ?? 'classrooms-test-classroom',
    displayName: params.displayName ?? 'Classrooms Classroom',
    defaultGroupId: params.defaultGroupId,
  });
  return { classroomId: classroom.id };
}

describe('ClassroomPath classrooms integration (/cp/trpc)', async () => {
  test('classrooms.list/getById include currentGroupId from schedule (or default)', async () => {
    await resetDb();

    const adminUserId = 'classrooms-admin';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });

    const { groupId: defaultGroupId } = await createGroup({ token: adminToken }, 'default-group');
    const { groupId: scheduledGroupId } = await createGroup(
      { token: adminToken },
      'scheduled-group'
    );
    const { classroomId } = await createClassroom({ token: adminToken }, { defaultGroupId });

    // Fixed local time: Tuesday 10:30 -> should match schedule dayOfWeek=2 (Tue)
    const inSlot = new Date(2026, 1, 3, 10, 30, 0, 0);
    await withFrozenDate(inSlot, async () => {
      const createSchedule = await trpcMutate(
        integration.baseUrl,
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
        integration.baseUrl,
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
        integration.baseUrl,
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
    await withFrozenDate(outOfSlot, async () => {
      const getResp = await trpcQuery(
        integration.baseUrl,
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

  test('classrooms.list/getById expose readable group names for teacher-facing default and current groups', async () => {
    await resetDb();

    const scenario = buildScenario();
    const { actor: admin, organization } = await scenario.createOrgAdmin({
      userId: 'classrooms-readable-admin',
      organizationName: 'Readable Classroom Org',
    });

    const adminGroup = await scenario.createGroup({
      token: admin.token,
      name: 'admin-readable-group',
      displayName: 'Plan Admin Visible',
    });

    const classroom = await scenario.createClassroom({
      token: admin.token,
      name: 'classroom-readable',
      displayName: 'Aula Visible',
      defaultGroupId: adminGroup.id,
    });

    const teacher = await scenario.addTeacher({
      adminToken: admin.token,
      organizationId: organization.organizationId,
      userId: 'classrooms-readable-teacher',
      name: 'Teacher Viewer',
      groupIds: [],
    });

    const listResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.list',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(listResp, 200);
    const { data: list } = (await parseTRPC(listResp)) as { data: any[] };
    const row = list.find((c) => c.id === classroom.id);
    assert.ok(row, 'classroom should be present for teacher');
    assert.strictEqual(row.defaultGroupId, adminGroup.id);
    assert.strictEqual(row.currentGroupId, adminGroup.id);
    assert.strictEqual(row.currentGroupSource, 'default');
    assert.strictEqual(row.defaultGroupDisplayName, 'Plan Admin Visible');
    assert.strictEqual(row.currentGroupDisplayName, 'Plan Admin Visible');

    const getResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.getById',
      { id: classroom.id },
      bearerAuth(teacher.token)
    );
    assertStatus(getResp, 200);
    const { data: got } = (await parseTRPC(getResp)) as { data: any };
    assert.strictEqual(got.defaultGroupDisplayName, 'Plan Admin Visible');
    assert.strictEqual(got.currentGroupDisplayName, 'Plan Admin Visible');
  });

  test('allows same classroom name in different organizations but blocks duplicates in same org', async () => {
    await resetDb();

    const sharedClassroomName = 'Laboratorio C';

    const adminAUserId = 'classrooms-admin-a';
    const adminAEmail = uniqueEmail('admin-a');
    await ensureOpenPathUser({ userId: adminAUserId, email: adminAEmail, name: 'Admin A' });
    const adminAToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminAUserId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminAToken,
      name: 'Classrooms Test Org',
    });

    const createA1 = await trpcMutate(
      integration.baseUrl,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminAToken)
    );
    assertStatus(createA1, 200);
    const { data: classroomA1 } = (await parseTRPC(createA1)) as { data: any };
    assert.ok(classroomA1?.id);

    const createA2Duplicate = await trpcMutate(
      integration.baseUrl,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminAToken)
    );
    assertStatus(createA2Duplicate, 409);

    const adminBUserId = 'classrooms-admin-b';
    const adminBEmail = uniqueEmail('admin-b');
    await ensureOpenPathUser({ userId: adminBUserId, email: adminBEmail, name: 'Admin B' });
    const adminBToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminBUserId,
      email: adminBEmail,
      name: 'Admin B',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminBToken,
      name: 'Classrooms Test Org',
    });

    const createB1 = await trpcMutate(
      integration.baseUrl,
      'classrooms.create',
      { name: sharedClassroomName },
      bearerAuth(adminBToken)
    );
    assertStatus(createB1, 200);
    const { data: classroomB1 } = (await parseTRPC(createB1)) as { data: any };
    assert.ok(classroomB1?.id);
    assert.notStrictEqual(String(classroomA1.id), String(classroomB1.id));

    const listAResp = await trpcQuery(
      integration.baseUrl,
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
      integration.baseUrl,
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
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });
    const { groupId } = await createGroup({ token: adminToken }, 'groups-update-target');

    const disableResp = await trpcMutate(
      integration.baseUrl,
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
      integration.baseUrl,
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
      jwtSecret: JWT_SECRET,
      userId: adminAUserId,
      email: adminAEmail,
      name: 'Admin A',
      roles: [{ role: 'admin' }],
    });
    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminAToken,
      name: 'Classrooms Test Org',
    });

    const adminBUserId = 'groups-delete-admin-b';
    const adminBEmail = uniqueEmail('gdb');
    await ensureOpenPathUser({ userId: adminBUserId, email: adminBEmail, name: 'Admin B' });
    const adminBToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminBUserId,
      email: adminBEmail,
      name: 'Admin B',
      roles: [{ role: 'admin' }],
    });
    const { organizationId: orgB } = await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminBToken,
      name: 'Classrooms Test Org',
    });

    const { groupId } = await createGroup({ token: adminAToken }, 'shared-group-delete-test');

    // Simulate an accidental/shared link: same whitelist group linked to a second org.
    await db.insert(cpSchema.cpOrganizationGroups).values({
      id: `og-b-${groupId}`,
      organizationId: orgB,
      groupId,
    });

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'groups.delete',
      { id: groupId },
      bearerAuth(adminAToken)
    );
    assertStatus(deleteResp, 200);

    const getResp = await trpcQuery(
      integration.baseUrl,
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
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });

    const { groupId: adminGroupId } = await createGroup({ token: adminToken }, 'admin-owned-group');
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'perms-classroom', displayName: 'Perms Classroom' }
    );

    const teacherUserId = 'classrooms-teacher-perms';
    const teacherEmail = uniqueEmail('teacher-perms');
    await ensureOpenPathUser({ userId: teacherUserId, email: teacherEmail, name: 'Teacher User' });
    const teacherToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: teacherUserId,
      email: teacherEmail,
      name: 'Teacher User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    await approveOrganizationMember({
      baseUrl: integration.baseUrl,
      adminToken,
      memberToken: teacherToken,
      memberUserId: teacherUserId,
      organizationId,
      role: 'teacher',
    });

    const forbiddenDefault = await trpcMutate(
      integration.baseUrl,
      'classrooms.update',
      { id: classroomId, defaultGroupId: adminGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(forbiddenDefault, 403);

    const teacherGroupResp = await trpcMutate(
      integration.baseUrl,
      'groups.create',
      { name: 'teacher-owned-group', displayName: 'Teacher Owned Group' },
      bearerAuth(teacherToken)
    );
    assertStatus(teacherGroupResp, 200);
    const { data: teacherGroup } = (await parseTRPC(teacherGroupResp)) as { data: any };
    assert.ok(teacherGroup?.id, 'groups.create should return id');
    const teacherGroupId = String(teacherGroup.id);

    const allowedDefault = await trpcMutate(
      integration.baseUrl,
      'classrooms.update',
      { id: classroomId, defaultGroupId: teacherGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(allowedDefault, 200);
    const { data: updated } = (await parseTRPC(allowedDefault)) as { data: any };
    assert.strictEqual(updated.defaultGroupId, teacherGroupId);
  });

  test('classrooms.listMachines returns org machines, supports filter, and includes download token metadata', async () => {
    await resetDb();

    const adminUserId = 'classrooms-machines-admin';
    const adminEmail = uniqueEmail('machines-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });

    const { classroomId: classroomA } = await createClassroom(
      { token: adminToken },
      { name: 'machines-classroom-a', displayName: 'Machines A' }
    );
    const { classroomId: classroomB } = await createClassroom(
      { token: adminToken },
      { name: 'machines-classroom-b', displayName: 'Machines B' }
    );

    const machineAId = 'machine-a';
    const machineBId = 'machine-b';
    const rotatedAt = new Date('2026-02-03T10:00:00.000Z');
    const lastSeen = new Date('2026-02-03T10:20:00.000Z');

    await openpathDb.insert(openpathSchema.machines).values([
      {
        id: machineAId,
        hostname: 'machine-a.test',
        classroomId: classroomA,
        version: '1.0.0',
        lastSeen,
        downloadTokenHash: 'token-hash-a',
        downloadTokenLastRotatedAt: rotatedAt,
      },
      {
        id: machineBId,
        hostname: 'machine-b.test',
        classroomId: classroomB,
        version: '2.0.0',
        lastSeen: null,
        downloadTokenHash: null,
        downloadTokenLastRotatedAt: null,
      },
    ]);

    const listAllResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.listMachines',
      {},
      bearerAuth(adminToken)
    );
    assertStatus(listAllResp, 200);
    const { data: all } = (await parseTRPC(listAllResp)) as { data: any[] };
    assert.strictEqual(all.length, 2);

    const rowA = all.find((m) => m.id === machineAId);
    assert.ok(rowA, 'machine A should be in listMachines');
    assert.strictEqual(rowA.classroomId, classroomA);
    assert.strictEqual(rowA.hasDownloadToken, true);
    assert.strictEqual(rowA.downloadTokenLastRotatedAt, rotatedAt.toISOString());
    assert.strictEqual(rowA.lastSeen, lastSeen.toISOString());

    const listAResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.listMachines',
      { classroomId: classroomA },
      bearerAuth(adminToken)
    );
    assertStatus(listAResp, 200);
    const { data: onlyA } = (await parseTRPC(listAResp)) as { data: any[] };
    assert.strictEqual(onlyA.length, 1);
    assert.strictEqual(onlyA[0].id, machineAId);

    const notFoundResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.listMachines',
      { classroomId: 'missing-classroom' },
      bearerAuth(adminToken)
    );
    assertStatus(notFoundResp, 404);
    const notFound = await parseTRPC(notFoundResp);
    assert.strictEqual(notFound.code, 'NOT_FOUND');
    assert.strictEqual(notFound.error, 'Classroom not found or access denied');
  });

  test('classrooms.listMachines and classrooms.deleteMachine are forbidden for students', async () => {
    await resetDb();

    const adminUserId = 'classrooms-student-gate-admin';
    const adminEmail = uniqueEmail('student-gate-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    const { organizationId } = await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });

    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'student-gate-classroom', displayName: 'Student Gate Classroom' }
    );

    const machineId = 'student-machine';
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: 'student-machine.test',
      classroomId,
      version: '1.0.0',
      lastSeen: new Date('2026-02-03T10:20:00.000Z'),
    });

    const studentUserId = 'classrooms-student';
    const studentEmail = uniqueEmail('student');
    await ensureOpenPathUser({ userId: studentUserId, email: studentEmail, name: 'Student User' });
    const studentToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: studentUserId,
      email: studentEmail,
      name: 'Student User',
      roles: [{ role: 'student' }],
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${studentUserId}`,
      userId: studentUserId,
      organizationId,
      role: 'student',
      invitedBy: adminUserId,
    });

    const listResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.listMachines',
      {},
      bearerAuth(studentToken)
    );
    assertStatus(listResp, 403);
    const listParsed = await parseTRPC(listResp);
    assert.strictEqual(listParsed.code, 'FORBIDDEN');
    assert.strictEqual(listParsed.error, 'Teacher access required');

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'classrooms.deleteMachine',
      { id: machineId, classroomId },
      bearerAuth(studentToken)
    );
    assertStatus(deleteResp, 403);
    const deleteParsed = await parseTRPC(deleteResp);
    assert.strictEqual(deleteParsed.code, 'FORBIDDEN');
    assert.strictEqual(deleteParsed.error, 'Teacher access required');
  });

  test('classrooms.deleteMachine deletes a machine in an accessible classroom', async () => {
    await resetDb();

    const adminUserId = 'classrooms-delete-machine-admin';
    const adminEmail = uniqueEmail('delete-machine-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'delete-machine-classroom', displayName: 'Delete Machine Classroom' }
    );

    const machineId = 'delete-machine-target';
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: 'delete-machine-target.test',
      classroomId,
      version: '1.0.0',
    });

    const deleteResp = await trpcMutate(
      integration.baseUrl,
      'classrooms.deleteMachine',
      { id: machineId, classroomId },
      bearerAuth(adminToken)
    );
    assertStatus(deleteResp, 200);
    const { data: deleted } = (await parseTRPC(deleteResp)) as { data: any };
    assert.strictEqual(deleted.success, true);

    const listResp = await trpcQuery(
      integration.baseUrl,
      'classrooms.listMachines',
      { classroomId },
      bearerAuth(adminToken)
    );
    assertStatus(listResp, 200);
    const { data: machinesList } = (await parseTRPC(listResp)) as { data: any[] };
    assert.ok(!machinesList.some((m) => m.id === machineId), 'machine should be deleted');
  });

  test('classrooms exemptions: create/list/delete happy path is idempotent within same schedule end', async () => {
    await resetDb();

    const adminUserId = 'classrooms-exemptions-admin';
    const adminEmail = uniqueEmail('exemptions-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'exemptions-classroom', displayName: 'Exemptions Classroom' }
    );

    const machineId = 'exemptions-machine';
    const machineHostname = 'exemptions-machine.test';
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: machineHostname,
      classroomId,
      version: '1.0.0',
    });

    const scheduleId = '00000000-0000-0000-0000-000000000001';
    await openpathDb.insert(openpathSchema.schedules).values({
      id: scheduleId,
      classroomId,
      teacherId: adminUserId,
      groupId: 'exemptions-group',
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '11:00',
    });

    const inSlot = new Date(2026, 1, 3, 10, 30, 45, 123);
    await withFrozenDate(inSlot, async () => {
      const create1 = await trpcMutate(
        integration.baseUrl,
        'classrooms.createExemption',
        { machineId, classroomId, scheduleId },
        bearerAuth(adminToken)
      );
      assertStatus(create1, 200);
      const { data: ex1 } = (await parseTRPC(create1)) as { data: any };
      assert.ok(String(ex1.id).startsWith('exempt_'));
      assert.strictEqual(ex1.machineId, machineId);
      assert.strictEqual(ex1.classroomId, classroomId);
      assert.strictEqual(ex1.scheduleId, scheduleId);
      assert.strictEqual(ex1.createdBy, adminUserId);
      assert.ok(ex1.expiresAt);

      const create2 = await trpcMutate(
        integration.baseUrl,
        'classrooms.createExemption',
        { machineId, classroomId, scheduleId },
        bearerAuth(adminToken)
      );
      assertStatus(create2, 200);
      const { data: ex2 } = (await parseTRPC(create2)) as { data: any };
      assert.strictEqual(ex2.id, ex1.id, 'createExemption should be idempotent within same expiry');

      const listResp = await trpcQuery(
        integration.baseUrl,
        'classrooms.listExemptions',
        { classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(listResp, 200);
      const { data: list } = (await parseTRPC(listResp)) as { data: any };
      assert.strictEqual(list.classroomId, classroomId);
      assert.strictEqual(list.exemptions.length, 1);
      assert.strictEqual(list.exemptions[0].id, ex1.id);
      assert.strictEqual(list.exemptions[0].machineHostname, machineHostname);

      const delResp = await trpcMutate(
        integration.baseUrl,
        'classrooms.deleteExemption',
        { id: ex1.id },
        bearerAuth(adminToken)
      );
      assertStatus(delResp, 200);
      const { data: deleted } = (await parseTRPC(delResp)) as { data: any };
      assert.strictEqual(deleted.success, true);

      const list2Resp = await trpcQuery(
        integration.baseUrl,
        'classrooms.listExemptions',
        { classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(list2Resp, 200);
      const { data: list2 } = (await parseTRPC(list2Resp)) as { data: any };
      assert.strictEqual(list2.exemptions.length, 0);
    });
  });

  test('classrooms.createExemption rejects weekends', async () => {
    await resetDb();

    const adminUserId = 'classrooms-weekend-exemptions-admin';
    const adminEmail = uniqueEmail('weekend-exemptions-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'weekend-exemptions-classroom', displayName: 'Weekend Exemptions Classroom' }
    );

    const machineId = 'weekend-exemptions-machine';
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: 'weekend-exemptions-machine.test',
      classroomId,
      version: '1.0.0',
    });

    const weekend = new Date(2026, 1, 7, 12, 0, 0, 0);
    await withFrozenDate(weekend, async () => {
      const resp = await trpcMutate(
        integration.baseUrl,
        'classrooms.createExemption',
        {
          machineId,
          classroomId,
          scheduleId: '00000000-0000-0000-0000-000000000002',
        },
        bearerAuth(adminToken)
      );
      assertStatus(resp, 400);
      const parsed = await parseTRPC(resp);
      assert.strictEqual(parsed.code, 'BAD_REQUEST');
      assert.strictEqual(parsed.error, 'Schedules are inactive on weekends');
    });
  });

  test('classrooms.setActiveGroup can set manual group and then revert to default', async () => {
    await resetDb();

    const adminUserId = 'classrooms-active-group-admin';
    const adminEmail = uniqueEmail('active-group-admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({
      baseUrl: integration.baseUrl,
      token: adminToken,
      name: 'Classrooms Test Org',
    });

    const { groupId: defaultGroupId } = await createGroup(
      { token: adminToken },
      'active-group-default'
    );
    const { groupId: manualGroupId } = await createGroup(
      { token: adminToken },
      'active-group-manual'
    );
    const { classroomId } = await createClassroom(
      { token: adminToken },
      { name: 'active-group-classroom', displayName: 'Active Group Classroom', defaultGroupId }
    );

    const setManualResp = await trpcMutate(
      integration.baseUrl,
      'classrooms.setActiveGroup',
      { id: classroomId, groupId: manualGroupId },
      bearerAuth(adminToken)
    );
    assertStatus(setManualResp, 200);
    const { data: manual } = (await parseTRPC(setManualResp)) as { data: any };
    assert.strictEqual(manual.currentGroupId, manualGroupId);
    assert.strictEqual(manual.currentGroupSource, 'manual');

    const clearResp = await trpcMutate(
      integration.baseUrl,
      'classrooms.setActiveGroup',
      { id: classroomId, groupId: null },
      bearerAuth(adminToken)
    );
    assertStatus(clearResp, 200);
    const { data: cleared } = (await parseTRPC(clearResp)) as { data: any };
    assert.strictEqual(cleared.currentGroupId, defaultGroupId);
    assert.strictEqual(cleared.currentGroupSource, 'default');
  });
});
