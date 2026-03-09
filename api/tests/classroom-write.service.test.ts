import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  createClassroomForTenant,
  deleteClassroomForTenant,
  setActiveGroupForTenant,
  updateClassroomForTenant,
} from '../src/services/classrooms/classroom-write.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_classroom_write_${RUN_ID}`;
const ADMIN_ID = `admin_classroom_write_${RUN_ID}`;
const GROUP_ID = `group_classroom_write_${RUN_ID}`;

const adminCtx = {
  organizationId: ORG_ID,
  userRole: 'admin' as const,
  user: { sub: ADMIN_ID },
};

async function cleanupTenantClassrooms() {
  const links = await db
    .select({ classroomId: schema.cpOrganizationClassrooms.classroomId })
    .from(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));

  const classroomIds = links.map((link) => link.classroomId);

  await db
    .delete(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));

  if (classroomIds.length > 0) {
    await openpathDb
      .delete(openpathSchema.classrooms)
      .where(inArray(openpathSchema.classrooms.id, classroomIds));
  }
}

describe('classroom-write.service', () => {
  before(async () => {
    await cleanupTenantClassrooms();
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
      email: `classroom-write-${RUN_ID}@example.com`,
      name: 'Classroom Write Admin',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: true,
    });

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Classroom Write Org ${RUN_ID}`,
      createdBy: ADMIN_ID,
    });

    await openpathDb.insert(openpathSchema.whitelistGroups).values({
      id: GROUP_ID,
      name: `classroom-write-group-${RUN_ID}`,
      displayName: 'Grupo Visible',
      enabled: 1,
    });

    await db.insert(schema.cpOrganizationGroups).values({
      id: `org_group_classroom_write_${RUN_ID}`,
      organizationId: ORG_ID,
      groupId: GROUP_ID,
      publicName: `classroom-write-group-${RUN_ID}`,
    });
  });

  after(async () => {
    await cleanupTenantClassrooms();
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb
      .delete(openpathSchema.whitelistGroups)
      .where(eq(openpathSchema.whitelistGroups.id, GROUP_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, ADMIN_ID));
  });

  it('creates, updates, activates and deletes tenant classrooms through the extracted write service', async () => {
    const created = await createClassroomForTenant({
      ctx: adminCtx,
      input: {
        name: 'laboratorio-escritura',
        displayName: 'Laboratorio Escritura',
        defaultGroupId: GROUP_ID,
      },
    });

    assert.ok(created.id, 'create should return a classroom id');
    assert.strictEqual(created.name, 'Laboratorio Escritura');
    assert.strictEqual(created.displayName, 'Laboratorio Escritura');
    assert.strictEqual(created.defaultGroupId, GROUP_ID);
    assert.strictEqual(created.defaultGroupDisplayName, 'Grupo Visible');
    assert.strictEqual(created.currentGroupId, GROUP_ID);
    assert.strictEqual(created.currentGroupSource, 'default');

    const updated = await updateClassroomForTenant({
      ctx: adminCtx,
      input: {
        id: created.id,
        displayName: 'Laboratorio Escritura 2',
      },
    });

    assert.strictEqual(updated.name, 'Laboratorio Escritura 2');
    assert.strictEqual(updated.displayName, 'Laboratorio Escritura 2');
    assert.strictEqual(updated.currentGroupSource, 'default');

    const manual = await setActiveGroupForTenant({
      ctx: adminCtx,
      classroomId: created.id,
      groupId: GROUP_ID,
    });

    assert.strictEqual(manual.activeGroupId, GROUP_ID);
    assert.strictEqual(manual.currentGroupId, GROUP_ID);
    assert.strictEqual(manual.currentGroupSource, 'manual');

    await deleteClassroomForTenant({ ctx: adminCtx, classroomId: created.id });

    const classroomRows = await openpathDb
      .select({ id: openpathSchema.classrooms.id })
      .from(openpathSchema.classrooms)
      .where(eq(openpathSchema.classrooms.id, created.id));
    assert.strictEqual(classroomRows.length, 0);

    const orgLinks = await db
      .select({ id: schema.cpOrganizationClassrooms.id })
      .from(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.classroomId, created.id));
    assert.strictEqual(orgLinks.length, 0);
  });
});
