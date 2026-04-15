import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { completeStripeCheckoutSession } from '../src/services/billing/billing-webhook-checkout.service.js';

describe('billing-webhook-checkout.service', () => {
  test('exports the checkout webhook handler', () => {
    assert.equal(typeof completeStripeCheckoutSession, 'function');
  });
});
