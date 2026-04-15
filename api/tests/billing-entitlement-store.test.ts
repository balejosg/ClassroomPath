import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  findEntitlementByStripeReference,
  getExistingBillingOrganization,
  updateEntitlementLifecycleFromStripe,
  upsertOrganizationEntitlement,
} from '../src/services/billing/billing-entitlement-store.js';

void describe('billing-entitlement-store', () => {
  void test('exports the entitlement persistence helpers', () => {
    assert.equal(typeof getExistingBillingOrganization, 'function');
    assert.equal(typeof upsertOrganizationEntitlement, 'function');
    assert.equal(typeof activateExistingOrganizationEntitlement, 'function');
    assert.equal(typeof createOrganizationWithEntitlement, 'function');
    assert.equal(typeof findEntitlementByStripeReference, 'function');
    assert.equal(typeof updateEntitlementLifecycleFromStripe, 'function');
  });
});
