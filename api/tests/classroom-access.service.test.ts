import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  getTenantClassroomById,
  listActiveClassroomExemptions,
  listTenantClassroomMachines,
  listTenantClassrooms,
} from '../src/services/classrooms/classroom-access.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_classroom_access_${RUN_ID}`;
const CLASSROOM_ID = `classroom_access_${RUN_ID}`;
const OTHER_CLASSROOM_ID = `classroom_access_other_${RUN_ID}`;
const MACHINE_ID = `machine_access_${RUN_ID}`;
const SCHEDULE_ID = '00000000-0000-0000-0000-00000000aa01';
const TEACHER_ID = `teacher_access_${RUN_ID}`;

describe('classroom-access.service', () => {
  before(async () => {
    await openpathDb
      .delete(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.schedules)
      .where(eq(openpathSchema.schedules.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.machines)
      .where(eq(openpathSchema.machines.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.machines)
      .where(eq(openpathSchema.machines.classroomId, OTHER_CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, OTHER_CLASSROOM_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, TEACHER_ID));
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Classroom Access ${RUN_ID}`,
      createdBy: 'doctor-test',
    });

    await openpathDb.insert(openpathSchema.users).values({
      id: TEACHER_ID,
      email: `teacher-access-${RUN_ID}@example.com`,
      name: 'Classroom Access Teacher',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.classrooms).values([
      {
        id: CLASSROOM_ID,
        name: `cp-${RUN_ID}-main`,
        displayName: 'Main Classroom',
      },
      {
        id: OTHER_CLASSROOM_ID,
        name: `cp-${RUN_ID}-other`,
        displayName: 'Other Classroom',
      },
    ]);

    await db.insert(schema.cpOrganizationClassrooms).values({
      id: `oc_main_${RUN_ID}`,
      organizationId: ORG_ID,
      classroomId: CLASSROOM_ID,
    });

    await openpathDb.insert(openpathSchema.machines).values([
      {
        id: MACHINE_ID,
        hostname: `machine-${RUN_ID}.test`,
        classroomId: CLASSROOM_ID,
        version: '1.0.0',
        lastSeen: new Date('2026-02-03T10:20:00.000Z'),
        downloadTokenHash: 'token-hash',
        downloadTokenLastRotatedAt: new Date('2026-02-03T10:00:00.000Z'),
      },
      {
        id: `${MACHINE_ID}-other`,
        hostname: `machine-${RUN_ID}-other.test`,
        classroomId: OTHER_CLASSROOM_ID,
        version: '2.0.0',
      },
    ]);

    await openpathDb.insert(openpathSchema.schedules).values([
      {
        id: SCHEDULE_ID,
        classroomId: CLASSROOM_ID,
        teacherId: TEACHER_ID,
        groupId: 'group-1',
        startAt: new Date('2026-02-03T10:00:00.000Z'),
        endAt: new Date('2026-02-03T11:00:00.000Z'),
        recurrence: 'once',
      },
      {
        id: '00000000-0000-0000-0000-00000000aa02',
        classroomId: CLASSROOM_ID,
        teacherId: TEACHER_ID,
        groupId: 'group-1',
        startAt: new Date('2020-02-03T10:00:00.000Z'),
        endAt: new Date('2020-02-03T11:00:00.000Z'),
        recurrence: 'once',
      },
    ]);

    await openpathDb.insert(openpathSchema.machineExemptions).values([
      {
        id: `exempt_active_${RUN_ID}`,
        machineId: MACHINE_ID,
        classroomId: CLASSROOM_ID,
        scheduleId: SCHEDULE_ID,
        createdBy: TEACHER_ID,
        expiresAt: new Date('2099-02-03T11:00:00.000Z'),
      },
      {
        id: `exempt_expired_${RUN_ID}`,
        machineId: MACHINE_ID,
        classroomId: CLASSROOM_ID,
        scheduleId: '00000000-0000-0000-0000-00000000aa02',
        createdBy: TEACHER_ID,
        expiresAt: new Date('2020-02-03T11:00:00.000Z'),
      },
    ]);
  });

  after(async () => {
    await openpathDb
      .delete(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.schedules)
      .where(eq(openpathSchema.schedules.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.machines)
      .where(eq(openpathSchema.machines.classroomId, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.machines)
      .where(eq(openpathSchema.machines.classroomId, OTHER_CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, CLASSROOM_ID));
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, OTHER_CLASSROOM_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, TEACHER_ID));
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
  });

  it('lists and fetches tenant classrooms through the extracted access service', async () => {
    const classrooms = await listTenantClassrooms({ organizationId: ORG_ID });
    assert.strictEqual(classrooms.length, 1);
    assert.strictEqual(classrooms[0]?.id, CLASSROOM_ID);

    const classroom = await getTenantClassroomById({ classroomId: CLASSROOM_ID });
    assert.ok(classroom);
    assert.strictEqual(classroom?.id, CLASSROOM_ID);
    assert.strictEqual(classroom?.name, 'Main Classroom');
  });

  it('lists machines only for classrooms linked to the organization', async () => {
    const machines = await listTenantClassroomMachines({ organizationId: ORG_ID });
    assert.strictEqual(machines.length, 1);
    assert.strictEqual(machines[0]?.id, MACHINE_ID);
    assert.strictEqual(machines[0]?.hasDownloadToken, true);
  });

  it('returns only active exemptions for the classroom', async () => {
    const result = await listActiveClassroomExemptions({
      classroomId: CLASSROOM_ID,
      now: new Date('2026-02-03T10:30:00.000Z'),
    });

    assert.strictEqual(result.classroomId, CLASSROOM_ID);
    assert.strictEqual(result.exemptions.length, 1);
    assert.strictEqual(result.exemptions[0]?.machineId, MACHINE_ID);
  });
});
