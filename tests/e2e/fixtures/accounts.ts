export interface TestUser {
  email: string;
  password: string;
  name: string;
}

export interface TestOrganization {
  name: string;
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

export const ADMIN_ACCOUNT = {
  email: 'admin@classroompath.test',
  password: 'AdminPassword123!',
  orgName: 'Test Organization',
};

export const TEACHER_ACCOUNT = {
  email: 'teacher@classroompath.test',
  password: 'TeacherPassword123!',
};

export const PENDING_USER_ACCOUNT = {
  email: 'pending@classroompath.test',
  password: 'PendingPassword123!',
};

export const ONBOARDING_USER_ACCOUNT = {
  email: 'onboarding@classroompath.test',
  password: 'OnboardingPassword123!',
};

const E2E_WORKER_ACCOUNT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_ACCOUNT_COUNT ?? '8', 10) || 8
);

const E2E_WORKER_STATE_VARIANTS = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_STATE_VARIANTS ?? '16', 10) || 16
);

function getWorkerSlot(): number {
  const workerIndex = Number.parseInt(process.env.TEST_WORKER_INDEX ?? '0', 10);
  if (!Number.isFinite(workerIndex) || workerIndex < 0) {
    return 1;
  }

  return (workerIndex % E2E_WORKER_ACCOUNT_COUNT) + 1;
}

function workerScopedEmail(
  role: 'admin' | 'teacher' | 'pending' | 'onboarding',
  variantOffset = 0
): string {
  const slot = getWorkerSlot();
  if (role === 'admin' || role === 'teacher') {
    return `${role}+w${slot}@classroompath.test`;
  }

  const variant = (Math.abs(variantOffset) % E2E_WORKER_STATE_VARIANTS) + 1;
  return `${role}+w${slot}-v${variant}@classroompath.test`;
}

export function getAdminAccountForWorker() {
  return {
    ...ADMIN_ACCOUNT,
    email: workerScopedEmail('admin'),
  };
}

export function getTeacherAccountForWorker() {
  return {
    ...TEACHER_ACCOUNT,
    email: workerScopedEmail('teacher'),
  };
}

export function getPendingAccountForWorker(variantOffset = 0) {
  return {
    ...PENDING_USER_ACCOUNT,
    email: workerScopedEmail('pending', variantOffset),
  };
}

export function getOnboardingAccountForWorker(variantOffset = 0) {
  return {
    ...ONBOARDING_USER_ACCOUNT,
    email: workerScopedEmail('onboarding', variantOffset),
  };
}
