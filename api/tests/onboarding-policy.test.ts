import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createOnboardingPolicy,
  getOnboardingAccessMode,
  resolveAutoSelectedOrganizationId,
  shouldShowOnboardingAccessPolicyNotice,
} from '../src/contracts/onboarding-policy';

describe('onboarding policy contract', () => {
  test('derives access mode from the policy flags', () => {
    assert.equal(
      getOnboardingAccessMode(
        createOnboardingPolicy({
          allowSelfServiceOrgs: true,
          allowOrgDirectory: true,
        })
      ),
      'directory'
    );

    assert.equal(
      getOnboardingAccessMode(
        createOnboardingPolicy({
          allowSelfServiceOrgs: false,
          allowOrgDirectory: false,
        })
      ),
      'invite_only'
    );
  });

  test('auto-selects the only organization when directory access is enabled', () => {
    const policy = createOnboardingPolicy({
      allowSelfServiceOrgs: false,
      allowOrgDirectory: true,
    });

    assert.equal(
      resolveAutoSelectedOrganizationId(policy, [{ id: 'org_1', name: 'Org 1' }], ''),
      'org_1'
    );
    assert.equal(shouldShowOnboardingAccessPolicyNotice(policy), false);
    assert.equal(
      shouldShowOnboardingAccessPolicyNotice(
        createOnboardingPolicy({
          allowSelfServiceOrgs: false,
          allowOrgDirectory: false,
        })
      ),
      true
    );
  });
});
