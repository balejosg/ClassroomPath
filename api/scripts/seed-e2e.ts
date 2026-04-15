/**
 * Seed deterministic data for ClassroomPath Playwright E2E.
 *
 * This script targets the shared Postgres DB used by:
 * - OpenPath API (users/roles/etc)
 * - ClassroomPath gateway (cp_* multi-tenant tables)
 */

import bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import {
  CLASSROOMPATH_TEST_RESET_TABLES,
  OPENPATH_TEST_RESET_TABLES,
} from '../src/db/test-table-inventory.js';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { listSeededE2EUsers, SEEDED_E2E_ORGANIZATION } from '@classroompath/testkit/test-actors';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for seed-e2e');
}

async function truncateAll(): Promise<void> {
  for (const table of CLASSROOMPATH_TEST_RESET_TABLES) {
    await truncateTable(db, table);
  }

  for (const table of OPENPATH_TEST_RESET_TABLES) {
    await truncateTable(openpathDb, table);
  }
}

async function truncateTable(executor: Pick<typeof db, 'execute'>, table: string): Promise<void> {
  try {
    await executor.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  } catch (error) {
    const code =
      error instanceof Error && 'cause' in error && error.cause && typeof error.cause === 'object'
        ? String((error.cause as { code?: unknown }).code ?? '')
        : '';

    if (code === '42P01') {
      return;
    }

    throw error;
  }
}

async function seed(): Promise<void> {
  await truncateAll();

  if (process.env.E2E_TRUNCATE_ONLY === '1') {
    console.log('Truncated E2E tables (truncate-only mode)');
    return;
  }

  const usersToSeed = listSeededE2EUsers();

  const hashByUserId = new Map<string, string>();
  await Promise.all(
    usersToSeed.map(async (user) => {
      hashByUserId.set(user.id, await bcrypt.hash(user.password, 10));
    })
  );

  await openpathDb.insert(openpathSchema.users).values(
    usersToSeed.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: hashByUserId.get(user.id)!,
      isActive: true as any,
      emailVerified: true as any,
    }))
  );

  const roleUsers = usersToSeed.filter(
    (user): user is (typeof usersToSeed)[number] & { role: 'admin' | 'teacher' } =>
      user.role === 'admin' || user.role === 'teacher'
  );

  await openpathDb.insert(openpathSchema.roles).values(
    roleUsers.map((user) => ({
      id: `role_${user.id}`,
      userId: user.id,
      role: user.role,
      groupIds: [] as any,
      createdBy: getSeededAdminId(),
    }))
  );

  await db.insert(schema.cpOrganizations).values({
    id: SEEDED_E2E_ORGANIZATION.id,
    name: SEEDED_E2E_ORGANIZATION.name,
    createdBy: getSeededAdminId(),
  });

  await db.insert(schema.cpOrganizationEntitlements).values({
    organizationId: SEEDED_E2E_ORGANIZATION.id,
    source: 'manual_admin',
    status: 'active',
    productKind: 'annual',
    classroomLimit: 100,
    grantedBy: getSeededAdminId(),
  });

  await db.insert(schema.cpMemberships).values(
    roleUsers.map((user) => ({
      id: `mem_${user.id}`,
      userId: user.id,
      organizationId: SEEDED_E2E_ORGANIZATION.id,
      role: user.role,
      invitedBy: user.role === 'admin' ? (null as any) : getSeededAdminId(),
    })) as any
  );

  const waitingUsers = usersToSeed.filter((user) => user.status === 'waiting');
  if (waitingUsers.length > 0) {
    await db.insert(schema.cpUserStatus).values(
      waitingUsers.map((user) => ({
        userId: user.id,
        status: 'waiting',
        // Keep seeded pending accounts reviewable by the seeded tenant admins.
        targetOrganizationId: SEEDED_E2E_ORGANIZATION.id,
      }))
    );
  }

  const workerAdmins = usersToSeed.filter((user) => user.kind === 'admin' && user.workerSlot);
  const workerTeachers = usersToSeed.filter((user) => user.kind === 'teacher' && user.workerSlot);
  const workerOnboardingUsers = usersToSeed.filter(
    (user) => user.kind === 'onboarding' && user.workerSlot
  );
  const workerPendingUsers = usersToSeed.filter(
    (user) => user.kind === 'pending' && user.workerSlot
  );

  console.log(
    `Seeded worker-scoped accounts: ${workerAdmins.length} admins, ${workerTeachers.length} teachers, ` +
      `${workerOnboardingUsers.length} onboarding users, ${workerPendingUsers.length} waiting users`
  );
}

function getSeededAdminId(): string {
  return (
    listSeededE2EUsers().find((user) => user.kind === 'admin' && !user.workerSlot)?.id ??
    'usr_admin_e2e'
  );
}

await seed();
if (process.env.E2E_TRUNCATE_ONLY === '1') {
  console.log('Truncate-only completed successfully');
} else {
  console.log('Seeded E2E data successfully');
}
