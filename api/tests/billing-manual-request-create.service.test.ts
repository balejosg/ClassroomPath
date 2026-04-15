import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createManualBillingRequest } from '../src/services/billing/billing-manual-request-create.service.js';

describe('billing-manual-request-create.service', () => {
  test('exports the manual billing request creation helper', () => {
    assert.equal(typeof createManualBillingRequest, 'function');
  });
});
