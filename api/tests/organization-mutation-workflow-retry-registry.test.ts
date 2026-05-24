import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrganizationMutationRetryHandler,
  organizationMutationRetryHandlers,
} from '../src/lib/organization-mutation-workflow/retry-registry.js';

void describe('organization-mutation-workflow/retry-registry', () => {
  void test('resolves registered retry handlers and fails closed for unknown operations', () => {
    assert.equal(
      typeof organizationMutationRetryHandlers['pending_users.approve_user'],
      'function'
    );
    assert.equal(typeof getOrganizationMutationRetryHandler('groups.create_group'), 'function');
    assert.equal(getOrganizationMutationRetryHandler('onboarding.create_organization'), undefined);
    assert.equal(getOrganizationMutationRetryHandler('unsupported.operation'), undefined);
  });
});
