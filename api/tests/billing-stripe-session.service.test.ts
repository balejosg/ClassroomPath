import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  createStripeCheckoutSession,
  formEncodeCheckout,
} from '../src/services/billing/billing-stripe-session.service.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  CP_BILLING_MODE: process.env.CP_BILLING_MODE,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('billing-stripe-session.service', () => {
  test('encodes Stripe checkout payloads with line items and metadata', () => {
    const body = formEncodeCheckout({
      mode: 'subscription',
      lineItems: [
        { price: 'price_annual', quantity: 12 },
        { price: 'price_onboarding', quantity: 1 },
      ],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      clientReferenceId: 'bill_123',
      email: 'admin@example.com',
      metadata: {
        organizationId: 'org_123',
        kind: 'annual',
      },
    });

    assert.equal(body.get('mode'), 'subscription');
    assert.equal(body.get('customer_email'), 'admin@example.com');
    assert.equal(body.get('line_items[0][price]'), 'price_annual');
    assert.equal(body.get('line_items[0][quantity]'), '12');
    assert.equal(body.get('line_items[1][price]'), 'price_onboarding');
    assert.equal(body.get('metadata[organizationId]'), 'org_123');
    assert.equal(body.get('metadata[kind]'), 'annual');
  });

  test('returns the Stripe checkout session on success', async () => {
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.test/session',
        }),
      }) as Response;

    const session = await createStripeCheckoutSession(new URLSearchParams('mode=payment'));

    assert.deepEqual(session, {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    });
  });

  test('surfaces Stripe error payloads on checkout session failure', async () => {
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    globalThis.fetch = async () =>
      ({
        ok: false,
        json: async () => ({
          error: { message: 'Stripe says no' },
        }),
      }) as Response;

    await assert.rejects(
      createStripeCheckoutSession(new URLSearchParams('mode=payment')),
      /Stripe says no/
    );
  });
});
