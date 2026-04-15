import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { listManualBillingRequests } from '../src/services/billing/billing-manual-request-read.service.js';

describe('billing-manual-request-read.service', () => {
  test('exports the manual billing request reader', () => {
    assert.equal(typeof listManualBillingRequests, 'function');
  });
});
