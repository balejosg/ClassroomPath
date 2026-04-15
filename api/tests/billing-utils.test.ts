import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  asStripeRecord,
  getBoolean,
  getNumber,
  getString,
  getUnixDate,
  toIso,
} from '../src/services/billing/billing-utils.js';

void describe('billing-utils', () => {
  void test('reads scalar Stripe fields and normalizes non-record values', () => {
    const record = asStripeRecord({
      id: 'cs_test_123',
      active: true,
      amount: 123,
      created: 1_700_000_000,
    });

    assert.equal(getString(record, 'id'), 'cs_test_123');
    assert.equal(getBoolean(record, 'active'), true);
    assert.equal(getNumber(record, 'amount'), 123);
    assert.equal(getUnixDate(record, 'created')?.toISOString(), '2023-11-14T22:13:20.000Z');
    assert.deepEqual(asStripeRecord(null), {});
  });

  void test('serializes dates and adds whole-day offsets', () => {
    const now = Date.now();
    const inTwoDays = addDays(2);

    assert.ok(inTwoDays.getTime() > now + 24 * 60 * 60 * 1000);
    assert.equal(toIso(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01T00:00:00.000Z');
    assert.equal(toIso(null), null);
  });
});
