import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStripeCheckoutSession,
  formEncodeCheckout,
  getLineItems,
} from '../src/services/billing/billing-stripe-checkout.service.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  CP_BILLING_MODE: process.env.CP_BILLING_MODE,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PILOT_PRICE: process.env.STRIPE_PILOT_PRICE,
  STRIPE_ANNUAL_PRICE_1_10: process.env.STRIPE_ANNUAL_PRICE_1_10,
  STRIPE_ANNUAL_PRICE_11_25: process.env.STRIPE_ANNUAL_PRICE_11_25,
  STRIPE_ANNUAL_PRICE_26_50: process.env.STRIPE_ANNUAL_PRICE_26_50,
  STRIPE_ANNUAL_PRICE_51_100: process.env.STRIPE_ANNUAL_PRICE_51_100,
  STRIPE_ONBOARDING_PRICE_1_25: process.env.STRIPE_ONBOARDING_PRICE_1_25,
  STRIPE_ONBOARDING_PRICE_26_100: process.env.STRIPE_ONBOARDING_PRICE_26_100,
};

function setStripeTestEnv() {
  process.env.CP_BILLING_MODE = 'stripe';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PILOT_PRICE = 'price_pilot';
  process.env.STRIPE_ANNUAL_PRICE_1_10 = 'price_annual_1_10';
  process.env.STRIPE_ANNUAL_PRICE_11_25 = 'price_annual_11_25';
  process.env.STRIPE_ANNUAL_PRICE_26_50 = 'price_annual_26_50';
  process.env.STRIPE_ANNUAL_PRICE_51_100 = 'price_annual_51_100';
  process.env.STRIPE_ONBOARDING_PRICE_1_25 = 'price_onboarding_1_25';
  process.env.STRIPE_ONBOARDING_PRICE_26_100 = 'price_onboarding_26_100';
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

void describe('billing-stripe-checkout.service', () => {
  void test('derives Stripe line items for pilot and annual checkout flows', () => {
    setStripeTestEnv();

    const pilotItems = getLineItems({ kind: 'pilot', classrooms: 8 });
    const annualItems = getLineItems({ kind: 'annual', classrooms: 12 });

    assert.deepEqual(pilotItems, [
      {
        price: 'price_pilot',
        quantity: 1,
      },
    ]);
    assert.deepEqual(annualItems, [
      {
        price: 'price_annual_11_25',
        quantity: 12,
      },
      {
        price: 'price_onboarding_1_25',
        quantity: 1,
      },
    ]);
  });

  void test('encodes Stripe checkout payloads with line items and metadata', () => {
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

  void test('returns the Stripe checkout session on success', async () => {
    setStripeTestEnv();

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

  void test('surfaces Stripe error payloads on checkout session failure', async () => {
    setStripeTestEnv();

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
