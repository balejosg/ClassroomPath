import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  getClassroomSchedulesForTenant,
  getTeacherSchedulesForTenant,
} from '../src/services/schedule-read.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_schedule_read_${RUN_ID}`;
const ADMIN_ID = `admin_schedule_read_${RUN_ID}`;
const TEACHER_ID = `teacher_schedule_read_${RUN_ID}`;
const GROUP_ID = `group_schedule_read_${RUN_ID}`;
const CLASSROOM_ID = `classroom_schedule_read_${RUN_ID}`;
const EXTERNAL_CLASSROOM_ID = `classroom_schedule_read_external_${RUN_ID}`;
const WEEKLY_ADMIN_ID = '00000000-0000-0000-0000-00000000bb11';
const ONE_OFF_ADMIN_ID = '00000000-0000-0000-0000-00000000bb12';
const WEEKLY_TEACHER_ID = '00000000-0000-0000-0000-00000000bb13';
const WEEKLY_EXTERNAL_ID = '00000000-0000-0000-0000-00000000bb14';

const teacherCtx = {
  organizationId: ORG_ID,
  userRole: 'teacher' as const,
  user: { sub: TEACHER_ID },
};

describe('schedule-read.service', () => {
  before(async () => {
    await openpathDb
      .delete(openpathSchema.schedules)
      .where(
        inArray(openpathSchema.schedules.id, [
          WEEKLY_ADMIN_ID,
          ONE_OFF_ADMIN_ID,
          WEEKLY_TEACHER_ID,
          WEEKLY_EXTERNAL_ID,
        ])
      );
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(inArray(openpathSchema.classrooms.id, [CLASSROOM_ID, EXTERNAL_CLASSROOM_ID]));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(eq(openpathSchema.whitelistGroups.id, GROUP_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(inArray(openpathSchema.users.id, [ADMIN_ID, TEACHER_ID]));

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: ADMIN_ID,
        email: `schedule-read-admin-${RUN_ID}@example.com`,
        name: 'Admin Reader',
        passwordHash: 'hashed_password_placeholder',
        isActive: true,
        emailVerified: true,
      },
      {
        id: TEACHER_ID,
        email: `schedule-read-teacher-${RUN_ID}@example.com`,
        name: 'Teacher Reader',
        passwordHash: 'hashed_password_placeholder',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Schedule Read Org ${RUN_ID}`,
      createdBy: ADMIN_ID,
    });

    await openpathDb.insert(openpathSchema.whitelistGroups).values({
      id: GROUP_ID,
      name: `schedule-read-group-${RUN_ID}`,
      displayName: 'Plan Visible',
      enabled: 1,
    });

    await db.insert(schema.cpOrganizationGroups).values({
      id: `org_group_schedule_read_${RUN_ID}`,
      organizationId: ORG_ID,
      groupId: GROUP_ID,
    });

    await openpathDb.insert(openpathSchema.classrooms).values([
      {
        id: CLASSROOM_ID,
        name: `cp-${RUN_ID}-schedule-read`,
        displayName: 'Aula Horarios',
      },
      {
        id: EXTERNAL_CLASSROOM_ID,
        name: `cp-${RUN_ID}-schedule-read-external`,
        displayName: 'Aula Externa',
      },
    ]);

    await db.insert(schema.cpOrganizationClassrooms).values({
      id: `org_classroom_schedule_read_${RUN_ID}`,
      organizationId: ORG_ID,
      classroomId: CLASSROOM_ID,
    });

    await openpathDb.insert(openpathSchema.schedules).values([
      {
        id: WEEKLY_ADMIN_ID,
        classroomId: CLASSROOM_ID,
        teacherId: ADMIN_ID,
        groupId: GROUP_ID,
        dayOfWeek: 2,
        startTime: '10:00',
        endTime: '11:00',
        startAt: null,
        endAt: null,
        recurrence: 'weekly',
      },
      {
        id: ONE_OFF_ADMIN_ID,
        classroomId: CLASSROOM_ID,
        teacherId: ADMIN_ID,
        groupId: GROUP_ID,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        startAt: new Date('2026-03-06T10:00:00.000Z'),
        endAt: new Date('2026-03-06T11:00:00.000Z'),
        recurrence: 'one_off',
      },
      {
        id: WEEKLY_TEACHER_ID,
        classroomId: CLASSROOM_ID,
        teacherId: TEACHER_ID,
        groupId: GROUP_ID,
        dayOfWeek: 3,
        startTime: '12:00',
        endTime: '13:00',
        startAt: null,
        endAt: null,
        recurrence: 'weekly',
      },
      {
        id: WEEKLY_EXTERNAL_ID,
        classroomId: EXTERNAL_CLASSROOM_ID,
        teacherId: TEACHER_ID,
        groupId: GROUP_ID,
        dayOfWeek: 4,
        startTime: '14:00',
        endTime: '15:00',
        startAt: null,
        endAt: null,
        recurrence: 'weekly',
      },
    ]);
  });

  after(async () => {
    await openpathDb
      .delete(openpathSchema.schedules)
      .where(
        inArray(openpathSchema.schedules.id, [
          WEEKLY_ADMIN_ID,
          ONE_OFF_ADMIN_ID,
          WEEKLY_TEACHER_ID,
          WEEKLY_EXTERNAL_ID,
        ])
      );
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(inArray(openpathSchema.classrooms.id, [CLASSROOM_ID, EXTERNAL_CLASSROOM_ID]));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(eq(openpathSchema.whitelistGroups.id, GROUP_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(inArray(openpathSchema.users.id, [ADMIN_ID, TEACHER_ID]));
  });

  it('reads classroom schedules with teacher-facing names and permissions', async () => {
    const data = await getClassroomSchedulesForTenant({
      ctx: teacherCtx,
      classroomId: CLASSROOM_ID,
    });

    assert.strictEqual(data.classroom.id, CLASSROOM_ID);
    assert.strictEqual(data.schedules.length, 2);
    assert.strictEqual(data.oneOffSchedules.length, 1);

    const adminSchedule = data.schedules.find((schedule) => schedule.id === WEEKLY_ADMIN_ID);
    assert.ok(adminSchedule);
    assert.strictEqual(adminSchedule.groupDisplayName, 'Plan Visible');
    assert.strictEqual(adminSchedule.teacherName, 'Admin Reader');
    assert.strictEqual(adminSchedule.canEdit, false);
    assert.strictEqual(adminSchedule.isMine, false);

    const teacherSchedule = data.schedules.find((schedule) => schedule.id === WEEKLY_TEACHER_ID);
    assert.ok(teacherSchedule);
    assert.strictEqual(teacherSchedule.canEdit, true);
    assert.strictEqual(teacherSchedule.isMine, true);

    assert.strictEqual(data.oneOffSchedules[0]?.teacherName, 'Admin Reader');
  });

  it('reads only the teacher weekly schedules that belong to tenant classrooms', async () => {
    const schedules = await getTeacherSchedulesForTenant({ ctx: teacherCtx });

    assert.strictEqual(schedules.length, 1);
    assert.strictEqual(schedules[0]?.id, WEEKLY_TEACHER_ID);
    assert.strictEqual(schedules[0]?.classroomId, CLASSROOM_ID);
    assert.strictEqual(schedules[0]?.groupDisplayName, 'Plan Visible');
    assert.strictEqual(schedules[0]?.teacherName, 'Teacher Reader');
  });
});
