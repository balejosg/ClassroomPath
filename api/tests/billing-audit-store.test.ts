import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  getBillingAuditTrail,
  recordBillingAuditEvent,
} from '../src/services/billing/billing-audit-store.js';

void describe('billing-audit-store', () => {
  void test('exports the billing audit persistence helpers', () => {
    assert.equal(typeof recordBillingAuditEvent, 'function');
    assert.equal(typeof getBillingAuditTrail, 'function');
  });
});
