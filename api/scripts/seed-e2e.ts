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
  name: 'E2E User',
  password: 'PendingPassword123!',
};

const ONBOARDING = {
  id: 'usr_onboarding_e2e',
  email: 'onboarding@classroompath.test',
  name: 'E2E User',
  password: 'OnboardingPassword123!',
};

const WORKER_ACCOUNT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_ACCOUNT_COUNT ?? '8', 10) || 8
);

const WORKER_STATE_VARIANTS = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_STATE_VARIANTS ?? '16', 10) || 16
);

type WorkerSeedUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'teacher' | null;
  status?: 'waiting';
};

function buildWorkerRoleUsers(role: 'admin' | 'teacher'): WorkerSeedUser[] {
  const password = role === 'admin' ? ADMIN.password : TEACHER.password;
  const roleTitle = role === 'admin' ? 'Admin' : 'Teacher';

  return Array.from({ length: WORKER_ACCOUNT_COUNT }, (_, index) => {
    const worker = index + 1;
    return {
      id: `usr_${role}_e2e_w${worker}`,
      email: `${role}+w${worker}@classroompath.test`,
      name: `E2E ${roleTitle} Worker ${worker}`,
      password,
      role,
    };
  });
}

function buildWorkerStateUsers(kind: 'onboarding' | 'pending'): WorkerSeedUser[] {
  const users: WorkerSeedUser[] = [];

  for (let worker = 1; worker <= WORKER_ACCOUNT_COUNT; worker++) {
    for (let variant = 1; variant <= WORKER_STATE_VARIANTS; variant++) {
      const isPending = kind === 'pending';
      users.push({
        id: `usr_${kind}_e2e_w${worker}_v${variant}`,
        email: `${kind}+w${worker}-v${variant}@classroompath.test`,
        name: `E2E User`,
        password: isPending ? PENDING.password : ONBOARDING.password,
        role: null,
        status: isPending ? 'waiting' : undefined,
      });
    }
  }

  return users;
}

const ORG = {
  id: 'org_e2e',
  name: 'Test Organization',
};

async function truncateAll(): Promise<void> {
  for (const table of CLASSROOMPATH_TEST_RESET_TABLES) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }

  for (const table of OPENPATH_TEST_RESET_TABLES) {
    await openpathDb.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }
}

async function seed(): Promise<void> {
  await truncateAll();

  if (process.env.E2E_TRUNCATE_ONLY === '1') {
    console.log('Truncated E2E tables (truncate-only mode)');
    return;
  }

  const workerAdmins = buildWorkerRoleUsers('admin');
  const workerTeachers = buildWorkerRoleUsers('teacher');
  const workerOnboardingUsers = buildWorkerStateUsers('onboarding');
  const workerPendingUsers = buildWorkerStateUsers('pending');

  const usersToSeed = [
    {
      id: ADMIN.id,
      email: ADMIN.email,
      name: ADMIN.name,
      password: ADMIN.password,
      role: 'admin' as const,
    },
    {
      id: TEACHER.id,
      email: TEACHER.email,
      name: TEACHER.name,
      password: TEACHER.password,
      role: 'teacher' as const,
    },
    {
      id: PENDING.id,
      email: PENDING.email,
      name: PENDING.name,
      password: PENDING.password,
      role: null,
      status: 'waiting' as const,
    },
    {
      id: ONBOARDING.id,
      email: ONBOARDING.email,
      name: ONBOARDING.name,
      password: ONBOARDING.password,
      role: null,
    },
    ...workerAdmins,
    ...workerTeachers,
    ...workerOnboardingUsers,
    ...workerPendingUsers,
  ];

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
      createdBy: ADMIN.id,
    }))
  );

  await db.insert(schema.cpOrganizations).values({
    id: ORG.id,
    name: ORG.name,
    createdBy: ADMIN.id,
  });

  await db.insert(schema.cpMemberships).values(
    roleUsers.map((user) => ({
      id: `mem_${user.id}`,
      userId: user.id,
      organizationId: ORG.id,
      role: user.role,
      invitedBy: user.role === 'admin' ? (null as any) : ADMIN.id,
    })) as any
  );

  // Used by cp users router list/getRole/etc.
  await db.insert(schema.cpOrganizationUsers).values(
    roleUsers.map((user) => ({
      id: `orguser_${user.id}`,
      organizationId: ORG.id,
      openpathUserId: user.id,
    }))
  );

  const waitingUsers = usersToSeed.filter((user) => user.status === 'waiting');
  if (waitingUsers.length > 0) {
    await db.insert(schema.cpUserStatus).values(
      waitingUsers.map((user) => ({
        userId: user.id,
        status: 'waiting',
        // Keep seeded pending accounts reviewable by the seeded tenant admins.
        targetOrganizationId: ORG.id,
      }))
    );
  }

  console.log(
    `Seeded worker-scoped accounts: ${WORKER_ACCOUNT_COUNT} admins, ${WORKER_ACCOUNT_COUNT} teachers, ` +
      `${workerOnboardingUsers.length} onboarding users, ${workerPendingUsers.length} waiting users`
  );
}

await seed();
if (process.env.E2E_TRUNCATE_ONLY === '1') {
  console.log('Truncate-only completed successfully');
} else {
  console.log('Seeded E2E data successfully');
}
