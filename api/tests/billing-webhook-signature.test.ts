import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { verifyStripeSignature } from '../src/services/billing/billing-webhook-signature.js';

describe('billing-webhook-signature', () => {
  test('accepts a valid Stripe-style signature header', () => {
    const payload = JSON.stringify({ id: 'evt_valid' });
    const timestamp = '1713110400';
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

    assert.doesNotThrow(() => {
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret);
    });
  });

  test('rejects headers that are missing required Stripe signature parts', () => {
    assert.throws(
      () => verifyStripeSignature('{}', 'v1=only-signature', 'whsec_test'),
      /Missing Stripe signature components/
    );
  });

  test('rejects headers whose computed signature does not match the payload', () => {
    assert.throws(
      () => verifyStripeSignature('{"id":"evt_bad"}', 't=1713110400,v1=deadbeef', 'whsec_test'),
      /Invalid Stripe signature/
    );
  });
});
