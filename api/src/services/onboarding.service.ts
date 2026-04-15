import {
  clearWaitingStatus as removeWaitingStatus,
  setWaitingStatus as upsertWaitingStatus,
} from './waiting-status.service.js';
import {
  assertCanStartOnboarding,
  getOnboardingPolicy,
  getOnboardingStatus,
  type OnboardingStatus,
} from './onboarding-status.service.js';

export type { OnboardingPolicy } from '@classroompath/contracts/onboarding-policy';
export type { OnboardingStatusDto } from '@classroompath/presenters/onboarding';
export type { OnboardingStatus } from './onboarding-status.service.js';
export { assertCanStartOnboarding, getOnboardingPolicy, getOnboardingStatus };
export { createOrganization } from './onboarding-create-organization.service.js';

export async function setWaitingStatus(userId: string): Promise<void> {
  await upsertWaitingStatus(userId);
}

export async function clearWaitingStatus(userId: string): Promise<void> {
  await removeWaitingStatus(userId);
}
