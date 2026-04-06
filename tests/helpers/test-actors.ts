export type TenantActorRole = 'admin' | 'teacher' | 'student';
export type SeededE2EActorKind = 'admin' | 'teacher' | 'pending' | 'onboarding';

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

export interface TestOrganization {
  name: string;
}

export interface SeededE2EUser extends TestUser {
  id: string;
  kind: SeededE2EActorKind;
  role: TenantActorRole | null;
  status?: 'waiting';
  orgName?: string;
  workerSlot?: number;
  variantOffset?: number;
}

type SeededE2EActorDefinition = {
  id: string;
  name: string;
  password: string;
  role: TenantActorRole | null;
  status?: 'waiting';
  orgName?: string;
};

export const SEEDED_E2E_ORGANIZATION = {
  id: 'org_e2e',
  name: 'Test Organization',
} as const;

const SEEDED_E2E_ACTOR_DEFINITIONS: Record<SeededE2EActorKind, SeededE2EActorDefinition> = {
  admin: {
    id: 'usr_admin_e2e',
    name: 'E2E Admin',
    password: 'AdminPassword123!',
    role: 'admin',
    orgName: SEEDED_E2E_ORGANIZATION.name,
  },
  teacher: {
    id: 'usr_teacher_e2e',
    name: 'E2E Teacher',
    password: 'TeacherPassword123!',
    role: 'teacher',
  },
  pending: {
    id: 'usr_pending_e2e',
    name: 'E2E User',
    password: 'PendingPassword123!',
    role: null,
    status: 'waiting',
  },
  onboarding: {
    id: 'usr_onboarding_e2e',
    name: 'E2E User',
    password: 'OnboardingPassword123!',
    role: null,
  },
};

const WORKER_SCOPED_ROLE_KINDS = ['admin', 'teacher'] as const;
const WORKER_SCOPED_STATE_KINDS = ['pending', 'onboarding'] as const;

export const E2E_WORKER_ACCOUNT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_ACCOUNT_COUNT ?? '8', 10) || 8
);

export const E2E_WORKER_STATE_VARIANTS = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_STATE_VARIANTS ?? '16', 10) || 16
);

export function getDefaultTenantActorName(role: TenantActorRole): string {
  switch (role) {
    case 'admin':
      return 'Admin User';
    case 'teacher':
      return 'Teacher User';
    case 'student':
      return 'Student User';
  }
}

export function getDefaultTenantEmailPrefix(role: TenantActorRole): string {
  return role;
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `test-${timestamp}-${random}@e2e-classroompath.local`,
    password: 'SecurePassword123!',
    name: `E2E User ${timestamp}`,
    ...overrides,
  };
}

export function createTestOrganization(
  overrides: Partial<TestOrganization> = {}
): TestOrganization {
  const timestamp = Date.now();
  return {
    name: `E2E Organization ${timestamp}`,
    ...overrides,
  };
}

export function getE2EBaseUrl(): string {
  return process.env.BASE_URL ?? 'http://localhost:5173';
}

export function getWorkerSlot(testWorkerIndex = process.env.TEST_WORKER_INDEX): number {
  const workerIndex = Number.parseInt(testWorkerIndex ?? '0', 10);
  if (!Number.isFinite(workerIndex) || workerIndex < 0) {
    return 1;
  }

  return (workerIndex % E2E_WORKER_ACCOUNT_COUNT) + 1;
}

function getSeededEmail(kind: SeededE2EActorKind, workerSlot?: number, variantOffset = 0): string {
  if (!workerSlot) {
    return `${kind}@classroompath.test`;
  }

  if (WORKER_SCOPED_ROLE_KINDS.includes(kind as (typeof WORKER_SCOPED_ROLE_KINDS)[number])) {
    return `${kind}+w${workerSlot}@classroompath.test`;
  }

  const variant = (Math.abs(variantOffset) % E2E_WORKER_STATE_VARIANTS) + 1;
  return `${kind}+w${workerSlot}-v${variant}@classroompath.test`;
}

export function getSeededE2EBaseUser(kind: SeededE2EActorKind): SeededE2EUser {
  const definition = SEEDED_E2E_ACTOR_DEFINITIONS[kind];

  return {
    ...definition,
    kind,
    email: getSeededEmail(kind),
  };
}

export function getWorkerScopedSeededE2EUser(
  kind: SeededE2EActorKind,
  variantOffset = 0,
  workerSlot = getWorkerSlot()
): SeededE2EUser {
  const definition = SEEDED_E2E_ACTOR_DEFINITIONS[kind];

  if (WORKER_SCOPED_ROLE_KINDS.includes(kind as (typeof WORKER_SCOPED_ROLE_KINDS)[number])) {
    const roleLabel = kind === 'admin' ? 'Admin' : 'Teacher';
    return {
      ...definition,
      id: `usr_${kind}_e2e_w${workerSlot}`,
      email: getSeededEmail(kind, workerSlot),
      name: `E2E ${roleLabel} Worker ${workerSlot}`,
      kind,
      workerSlot,
      variantOffset: 0,
    };
  }

  const variant = (Math.abs(variantOffset) % E2E_WORKER_STATE_VARIANTS) + 1;
  return {
    ...definition,
    id: `usr_${kind}_e2e_w${workerSlot}_v${variant}`,
    email: getSeededEmail(kind, workerSlot, variantOffset),
    kind,
    workerSlot,
    variantOffset: variant - 1,
  };
}

export function buildWorkerScopedSeededE2EUsers(kind: SeededE2EActorKind): SeededE2EUser[] {
  if (WORKER_SCOPED_ROLE_KINDS.includes(kind as (typeof WORKER_SCOPED_ROLE_KINDS)[number])) {
    return Array.from({ length: E2E_WORKER_ACCOUNT_COUNT }, (_, index) =>
      getWorkerScopedSeededE2EUser(kind, 0, index + 1)
    );
  }

  if (!WORKER_SCOPED_STATE_KINDS.includes(kind as (typeof WORKER_SCOPED_STATE_KINDS)[number])) {
    return [];
  }

  const users: SeededE2EUser[] = [];
  for (let workerSlot = 1; workerSlot <= E2E_WORKER_ACCOUNT_COUNT; workerSlot++) {
    for (let variantOffset = 0; variantOffset < E2E_WORKER_STATE_VARIANTS; variantOffset++) {
      users.push(getWorkerScopedSeededE2EUser(kind, variantOffset, workerSlot));
    }
  }

  return users;
}

export function listSeededE2EUsers(): SeededE2EUser[] {
  return [
    getSeededE2EBaseUser('admin'),
    getSeededE2EBaseUser('teacher'),
    getSeededE2EBaseUser('pending'),
    getSeededE2EBaseUser('onboarding'),
    ...buildWorkerScopedSeededE2EUsers('admin'),
    ...buildWorkerScopedSeededE2EUsers('teacher'),
    ...buildWorkerScopedSeededE2EUsers('onboarding'),
    ...buildWorkerScopedSeededE2EUsers('pending'),
  ];
}
