import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_AUDIT_TARGET_CHECKOUT,
  BILLING_AUDIT_TARGET_ENTITLEMENT,
  BILLING_AUDIT_TARGET_REQUEST,
  BILLING_GRACE_PERIOD_DAYS,
  PILOT_DURATION_DAYS,
} from '../src/services/billing/billing-types.js';

void describe('billing-types', () => {
  void test('exports the canonical billing constants', () => {
    assert.equal(BILLING_GRACE_PERIOD_DAYS, 7);
    assert.equal(PILOT_DURATION_DAYS, 90);
    assert.equal(BILLING_AUDIT_TARGET_ENTITLEMENT, 'organization_entitlement');
    assert.equal(BILLING_AUDIT_TARGET_REQUEST, 'billing_manual_request');
    assert.equal(BILLING_AUDIT_TARGET_CHECKOUT, 'billing_checkout_intent');
  });
});
