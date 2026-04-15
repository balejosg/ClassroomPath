import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as onboardingFlowService from '../src/services/onboarding-flow.service.js';

describe('onboarding-flow service', () => {
  it('exposes the public onboarding flow use-cases', () => {
    assert.deepEqual(Object.keys(onboardingFlowService).sort(), [
      'cancelWaitingForInvitation',
      'createOrganizationSession',
      'listAvailableOrganizations',
      'setWaitingForInvitation',
    ]);
  });
});
