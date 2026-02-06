/**
 * Seed deterministic data for ClassroomPath Playwright E2E.
 *
 * This script targets the shared Postgres DB used by:
 * - OpenPath API (users/roles/etc)
 * - ClassroomPath gateway (cp_* multi-tenant tables)
 */

import bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for seed-e2e');
}

const ADMIN = {
  id: 'usr_admin_e2e',
  email: 'admin@classroompath.test',
  name: 'E2E Admin',
  password: 'AdminPassword123!',
};

const TEACHER = {
  id: 'usr_teacher_e2e',
  email: 'teacher@classroompath.test',
  name: 'E2E Teacher',
  password: 'TeacherPassword123!',
};

const PENDING = {
  id: 'usr_pending_e2e',
  email: 'pending@classroompath.test',
  name: 'E2E Pending',
  password: 'PendingPassword123!',
};

const ORG = {
  id: 'org_e2e',
  name: 'Test Organization',
};

async function truncateAll(): Promise<void> {
  const cpTables = [
    'cp_organization_users',
    'cp_organization_groups',
    'cp_organization_classrooms',
    'cp_memberships',
    'cp_organizations',
    'cp_user_status',
  ];

  for (const table of cpTables) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }

  const opTables = [
    'users',
    'roles',
    'tokens',
    'classrooms',
    'schedules',
    'requests',
    'machines',
    'settings',
  ];

  for (const table of opTables) {
    await openpathDb.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }
}

async function seed(): Promise<void> {
  await truncateAll();

  const [adminHash, teacherHash, pendingHash] = await Promise.all([
    bcrypt.hash(ADMIN.password, 10),
    bcrypt.hash(TEACHER.password, 10),
    bcrypt.hash(PENDING.password, 10),
  ]);

  await openpathDb.insert(openpathSchema.users).values({
    id: ADMIN.id,
    email: ADMIN.email,
    name: ADMIN.name,
    passwordHash: adminHash,
    isActive: true as any,
    emailVerified: true as any,
  });

  await openpathDb.insert(openpathSchema.users).values({
    id: TEACHER.id,
    email: TEACHER.email,
    name: TEACHER.name,
    passwordHash: teacherHash,
    isActive: true as any,
    emailVerified: true as any,
  });

  await openpathDb.insert(openpathSchema.users).values({
    id: PENDING.id,
    email: PENDING.email,
    name: PENDING.name,
    passwordHash: pendingHash,
    isActive: true as any,
    emailVerified: true as any,
  });

  await openpathDb.insert(openpathSchema.roles).values({
    id: 'role_admin_e2e',
    userId: ADMIN.id,
    role: 'admin',
    groupIds: [] as any,
    createdBy: ADMIN.id,
  });

  await openpathDb.insert(openpathSchema.roles).values({
    id: 'role_teacher_e2e',
    userId: TEACHER.id,
    role: 'teacher',
    groupIds: [] as any,
    createdBy: ADMIN.id,
  });

  await db.insert(schema.cpOrganizations).values({
    id: ORG.id,
    name: ORG.name,
    createdBy: ADMIN.id,
  });

  await db.insert(schema.cpMemberships).values({
    id: 'mem_admin_e2e',
    userId: ADMIN.id,
    organizationId: ORG.id,
    role: 'admin',
    invitedBy: null as any,
  } as any);

  await db.insert(schema.cpMemberships).values({
    id: 'mem_teacher_e2e',
    userId: TEACHER.id,
    organizationId: ORG.id,
    role: 'teacher',
    invitedBy: ADMIN.id,
  } as any);

  // Used by cp users router list/getRole/etc.
  await db.insert(schema.cpOrganizationUsers).values({
    id: 'orguser_admin_e2e',
    organizationId: ORG.id,
    openpathUserId: ADMIN.id,
  });
  await db.insert(schema.cpOrganizationUsers).values({
    id: 'orguser_teacher_e2e',
    organizationId: ORG.id,
    openpathUserId: TEACHER.id,
  });

  // Provide at least one deterministic waiting user for admin pending views.
  await db.insert(schema.cpUserStatus).values({
    userId: PENDING.id,
    status: 'waiting',
  });
}

await seed();
console.log('Seeded E2E data successfully');
