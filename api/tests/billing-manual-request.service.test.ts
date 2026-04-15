import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  approveManualBillingRequest,
  createManualBillingRequest,
  listManualBillingRequests,
  rejectManualBillingRequest,
} from '../src/services/billing/billing-manual-request.service.js';

void describe('billing-manual-request.service', () => {
  void test('exports the manual billing request lifecycle helpers', () => {
    assert.equal(typeof createManualBillingRequest, 'function');
    assert.equal(typeof listManualBillingRequests, 'function');
    assert.equal(typeof approveManualBillingRequest, 'function');
    assert.equal(typeof rejectManualBillingRequest, 'function');
  });
});
