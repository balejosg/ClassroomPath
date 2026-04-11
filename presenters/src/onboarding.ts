import type { OnboardingPolicy } from '@classroompath/contracts/onboarding-policy';

export interface OrganizationSummaryDto {
  id: string;
  name: string;
}

export interface OnboardingOrganizationDto extends OrganizationSummaryDto {
  role: string;
}

export interface OnboardingRoleInfo {
  role: string;
  groupIds: string[];
}

export interface OnboardingUserDto {
  id: string;
  email: string;
  name: string;
  roles: OnboardingRoleInfo[];
}

export interface OnboardingStatusDto {
  hasMembership: boolean;
  isWaiting: boolean;
  organization: OnboardingOrganizationDto | null;
  platformAdmin: boolean;
  billing: {
    hasActiveEntitlement: boolean;
    source: string | null;
    status: 'active' | 'grace_period' | 'canceled' | 'expired' | null;
    productKind: string | null;
    classroomLimit: number | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    expiresAt: string | null;
  } | null;
  policy: OnboardingPolicy;
}

export interface CreateOrganizationSuccessDto {
  success: boolean;
  organizationId: string;
  user: OnboardingUserDto;
}
