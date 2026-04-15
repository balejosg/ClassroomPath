import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addDays,
  effectiveEntitlementStatus,
  isActiveEntitlement,
  toBillingStatusDto,
  toIso,
} from '../src/services/billing/billing-entitlement-status.js';

void describe('billing-entitlement-status', () => {
  void test('exports the entitlement status helpers', () => {
    assert.equal(typeof addDays, 'function');
    assert.equal(typeof effectiveEntitlementStatus, 'function');
    assert.equal(typeof isActiveEntitlement, 'function');
    assert.equal(typeof toIso, 'function');
    assert.equal(typeof toBillingStatusDto, 'function');
  });
});
