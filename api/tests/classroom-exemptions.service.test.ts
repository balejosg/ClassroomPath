import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { createClassroomForTenant } from '../src/services/classrooms/classroom-write.service.js';
import {
  createClassroomExemptionForTenant,
  createOperationalClassroomExemptionForTenant,
  deleteClassroomExemptionForTenant,
} from '../src/services/classrooms/classroom-exemptions.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_classroom_exemptions_${RUN_ID}`;
const ADMIN_ID = `admin_classroom_exemptions_${RUN_ID}`;
const GROUP_ID = `group_classroom_exemptions_${RUN_ID}`;

const adminCtx = {
  organizationId: ORG_ID,
  userRole: 'admin' as const,
  user: { sub: ADMIN_ID },
};

const teacherCtx = {
  organizationId: ORG_ID,
  userRole: 'teacher' as const,
  user: { sub: `teacher_classroom_exemptions_${RUN_ID}` },
};

async function cleanupTenantFixtures() {
  const links = await db
    .select({ classroomId: schema.cpOrganizationClassrooms.classroomId })
    .from(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));

  const classroomIds = links.map((link) => link.classroomId);

  await db
    .delete(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));

  if (classroomIds.length === 0) {
    return;
  }

  await openpathDb
    .delete(openpathSchema.machineExemptions)
    .where(inArray(openpathSchema.machineExemptions.classroomId, classroomIds));
  await openpathDb
    .delete(openpathSchema.schedules)
    .where(inArray(openpathSchema.schedules.classroomId, classroomIds));
  await openpathDb
    .delete(openpathSchema.machines)
    .where(inArray(openpathSchema.machines.classroomId, classroomIds));
  await openpathDb
    .delete(openpathSchema.classrooms)
    .where(inArray(openpathSchema.classrooms.id, classroomIds));
}

describe('classroom-exemptions.service', () => {
  before(async () => {
    await acquireTestDbLock();
    await cleanupTenantFixtures();
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(eq(openpathSchema.whitelistGroups.id, GROUP_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, ADMIN_ID));

    await openpathDb.insert(openpathSchema.users).values({
      id: ADMIN_ID,
      email: `classroom-exemptions-${RUN_ID}@example.com`,
      name: 'Classroom Exemptions Admin',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Classroom Exemptions Org ${RUN_ID}`,
      createdBy: ADMIN_ID,
    });

    await openpathDb.insert(openpathSchema.whitelistGroups).values({
      id: GROUP_ID,
      name: `classroom-exemptions-group-${RUN_ID}`,
      displayName: 'Grupo Exenciones',
      enabled: 1,
    });

    await db.insert(schema.cpOrganizationGroups).values({
      id: `org_group_classroom_exemptions_${RUN_ID}`,
      organizationId: ORG_ID,
      groupId: GROUP_ID,
      publicName: `classroom-exemptions-group-${RUN_ID}`,
    });
  });

  after(async () => {
    try {
      await cleanupTenantFixtures();
      await db
        .delete(schema.cpOrganizationGroups)
        .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb
        .delete(openpathSchema.whitelistGroups)
        .where(eq(openpathSchema.whitelistGroups.id, GROUP_ID));
      await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, ADMIN_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('creates idempotent classroom exemptions and deletes them through the extracted service', async () => {
    const classroom = await createClassroomForTenant({
      ctx: adminCtx,
      input: {
        name: 'classroom-exemptions',
        displayName: 'Classroom Exemptions',
        defaultGroupId: GROUP_ID,
      },
    });

    const machineId = `machine_classroom_exemptions_${RUN_ID}`;
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: `machine-classroom-exemptions-${RUN_ID}.test`,
      classroomId: classroom.id,
      version: '1.0.0',
    });

    const scheduleId = '00000000-0000-4000-8000-000000000011';
    const now = new Date();
    await openpathDb.insert(openpathSchema.schedules).values({
      id: scheduleId,
      classroomId: classroom.id,
      teacherId: ADMIN_ID,
      groupId: GROUP_ID,
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
      recurrence: 'one_off',
    });

    const created = await createClassroomExemptionForTenant({
      ctx: adminCtx,
      input: {
        machineId,
        classroomId: classroom.id,
        scheduleId,
      },
    });

    assert.ok(created.id.startsWith('exempt_'));
    assert.strictEqual(created.machineId, machineId);
    assert.strictEqual(created.classroomId, classroom.id);
    assert.strictEqual(created.scheduleId, scheduleId);
    assert.strictEqual(created.createdBy, ADMIN_ID);
    assert.ok(created.expiresAt);

    const duplicate = await createClassroomExemptionForTenant({
      ctx: adminCtx,
      input: {
        machineId,
        classroomId: classroom.id,
        scheduleId,
      },
    });

    assert.strictEqual(duplicate.id, created.id);

    const rows = await openpathDb
      .select({ id: openpathSchema.machineExemptions.id })
      .from(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.classroomId, classroom.id));
    assert.strictEqual(rows.length, 1);

    await deleteClassroomExemptionForTenant({
      ctx: adminCtx,
      id: created.id,
    });

    const remaining = await openpathDb
      .select({ id: openpathSchema.machineExemptions.id })
      .from(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.classroomId, classroom.id));
    assert.strictEqual(remaining.length, 0);
  });

  it('persists and presents groupId when creating a classroom exemption with a group', async () => {
    const classroom = await createClassroomForTenant({
      ctx: adminCtx,
      input: {
        name: 'classroom-exemptions-groupid',
        displayName: 'Classroom Exemptions GroupId',
        defaultGroupId: GROUP_ID,
      },
    });

    const machineId = `machine_groupid_exemptions_${RUN_ID}`;
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: `machine-groupid-exemptions-${RUN_ID}.test`,
      classroomId: classroom.id,
      version: '1.0.0',
    });

    const scheduleId = '00000000-0000-4000-8000-000000000022';
    const now = new Date();
    await openpathDb.insert(openpathSchema.schedules).values({
      id: scheduleId,
      classroomId: classroom.id,
      teacherId: ADMIN_ID,
      groupId: GROUP_ID,
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
      recurrence: 'one_off',
    });

    const created = await createClassroomExemptionForTenant({
      ctx: teacherCtx,
      input: {
        machineId,
        classroomId: classroom.id,
        scheduleId,
        groupId: GROUP_ID,
      },
    });

    assert.ok(created.id.startsWith('exempt_'));
    assert.strictEqual(created.machineId, machineId);
    assert.strictEqual(created.classroomId, classroom.id);
    assert.strictEqual(created.scheduleId, scheduleId);
    assert.strictEqual(created.groupId, GROUP_ID);
  });

  it('creates operational exemptions for admins and blocks teacher revocation', async () => {
    const classroom = await createClassroomForTenant({
      ctx: adminCtx,
      input: {
        name: 'classroom-operational-exemptions',
        displayName: 'Classroom Operational Exemptions',
        defaultGroupId: GROUP_ID,
      },
    });

    const machineId = `machine_operational_exemptions_${RUN_ID}`;
    await openpathDb.insert(openpathSchema.machines).values({
      id: machineId,
      hostname: `machine-operational-exemptions-${RUN_ID}.test`,
      classroomId: classroom.id,
      version: '1.0.0',
    });

    await assert.rejects(
      () =>
        createOperationalClassroomExemptionForTenant({
          ctx: teacherCtx,
          input: {
            machineId,
            classroomId: classroom.id,
            durationHours: 4,
            reason: 'Mantenimiento',
          },
        }),
      /Admin access required/
    );

    const before = new Date();
    const created = await createOperationalClassroomExemptionForTenant({
      ctx: adminCtx,
      input: {
        machineId,
        classroomId: classroom.id,
        durationHours: 4,
        reason: '  Mantenimiento urgente  ',
      },
    });

    assert.ok(created.id.startsWith('exempt_'));
    assert.strictEqual(created.machineId, machineId);
    assert.strictEqual(created.classroomId, classroom.id);
    assert.strictEqual(created.scheduleId, null);
    assert.strictEqual(created.source, 'operational');
    assert.strictEqual(created.reason, 'Mantenimiento urgente');
    assert.strictEqual(created.createdBy, ADMIN_ID);
    assert.ok(new Date(created.expiresAt).getTime() > before.getTime());

    const rows = await openpathDb
      .select({
        id: openpathSchema.machineExemptions.id,
        scheduleId: openpathSchema.machineExemptions.scheduleId,
        source: openpathSchema.machineExemptions.source,
        reason: openpathSchema.machineExemptions.reason,
      })
      .from(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.id, created.id));
    assert.deepStrictEqual(rows[0], {
      id: created.id,
      scheduleId: null,
      source: 'operational',
      reason: 'Mantenimiento urgente',
    });

    await assert.rejects(
      () =>
        deleteClassroomExemptionForTenant({
          ctx: teacherCtx,
          id: created.id,
        }),
      /Only administrators can revoke operational exemptions/
    );

    await deleteClassroomExemptionForTenant({
      ctx: adminCtx,
      id: created.id,
    });

    const remaining = await openpathDb
      .select({ id: openpathSchema.machineExemptions.id })
      .from(openpathSchema.machineExemptions)
      .where(eq(openpathSchema.machineExemptions.id, created.id));
    assert.strictEqual(remaining.length, 0);
  });
});
