import {
  createTestOrganization,
  createTestUser,
  getE2EBaseUrl,
  getSeededE2EBaseUser,
  getWorkerScopedSeededE2EUser,
  type TestOrganization,
  type TestUser,
} from '../../helpers/test-actors';

export type { TestOrganization, TestUser };

export { createTestOrganization, createTestUser, getE2EBaseUrl };

export const ADMIN_ACCOUNT = getSeededE2EBaseUser('admin');
export const TEACHER_ACCOUNT = getSeededE2EBaseUser('teacher');
export const PENDING_USER_ACCOUNT = getSeededE2EBaseUser('pending');
export const ONBOARDING_USER_ACCOUNT = getSeededE2EBaseUser('onboarding');

export function getAdminAccountForWorker() {
  return getWorkerScopedSeededE2EUser('admin');
}

export function getTeacherAccountForWorker() {
  return getWorkerScopedSeededE2EUser('teacher');
}

export function getPendingAccountForWorker(variantOffset = 0) {
  return getWorkerScopedSeededE2EUser('pending', variantOffset);
}

export function getOnboardingAccountForWorker(variantOffset = 0) {
  return getWorkerScopedSeededE2EUser('onboarding', variantOffset);
}
