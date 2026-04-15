import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findEntitlementByStripeReference,
  updateEntitlementLifecycleFromStripe,
} from '../src/services/billing/billing-entitlement-lifecycle.service.js';

describe('billing-entitlement-lifecycle.service', () => {
  test('exports the entitlement lifecycle helpers', () => {
    assert.equal(typeof findEntitlementByStripeReference, 'function');
    assert.equal(typeof updateEntitlementLifecycleFromStripe, 'function');
  });
});
