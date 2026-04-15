import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  approveManualBillingRequest,
  rejectManualBillingRequest,
} from '../src/services/billing/billing-manual-request-resolution.service.js';

describe('billing-manual-request-resolution.service', () => {
  test('exports the manual billing request resolution helpers', () => {
    assert.equal(typeof approveManualBillingRequest, 'function');
    assert.equal(typeof rejectManualBillingRequest, 'function');
  });
});
