import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  asStripeRecord,
  getBoolean,
  getNumber,
  getString,
  getUnixDate,
  readInvoiceCurrentPeriodEnd,
} from '../src/services/billing/billing-stripe-record.js';

void describe('billing-stripe-record', () => {
  void test('exports the Stripe payload parsing helpers', () => {
    assert.equal(typeof asStripeRecord, 'function');
    assert.equal(typeof getString, 'function');
    assert.equal(typeof getBoolean, 'function');
    assert.equal(typeof getNumber, 'function');
    assert.equal(typeof getUnixDate, 'function');
    assert.equal(typeof readInvoiceCurrentPeriodEnd, 'function');
  });
});
