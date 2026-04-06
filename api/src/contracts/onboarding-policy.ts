export interface OnboardingPolicy {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
}

export interface OnboardingOrganizationOption {
  id: string;
  name: string;
}

export type OnboardingAccessMode = 'directory' | 'invite_only';

export function createOnboardingPolicy(
  overrides: Partial<OnboardingPolicy> = {}
): OnboardingPolicy {
  return {
    allowSelfServiceOrgs: overrides.allowSelfServiceOrgs ?? false,
    allowOrgDirectory: overrides.allowOrgDirectory ?? false,
  };
}

export function getOnboardingAccessMode(policy: OnboardingPolicy): OnboardingAccessMode {
  return policy.allowOrgDirectory ? 'directory' : 'invite_only';
}

export function shouldShowOnboardingAccessPolicyNotice(policy: OnboardingPolicy): boolean {
  return getOnboardingAccessMode(policy) === 'invite_only';
}

export function resolveAutoSelectedOrganizationId(
  policy: OnboardingPolicy,
  organizations: OnboardingOrganizationOption[],
  currentTargetOrgId: string
): string {
  if (currentTargetOrgId) {
    return currentTargetOrgId;
  }

  if (getOnboardingAccessMode(policy) !== 'directory') {
    return '';
  }

  return organizations.length === 1 ? organizations[0].id : '';
}
