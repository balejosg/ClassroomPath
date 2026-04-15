import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  requireStripePrice,
  getLineItems,
} from '../src/services/billing/billing-stripe-pricing.service.js';

const originalEnv = {
  CP_BILLING_MODE: process.env.CP_BILLING_MODE,
  STRIPE_PILOT_PRICE: process.env.STRIPE_PILOT_PRICE,
  STRIPE_ANNUAL_PRICE_1_10: process.env.STRIPE_ANNUAL_PRICE_1_10,
  STRIPE_ANNUAL_PRICE_11_25: process.env.STRIPE_ANNUAL_PRICE_11_25,
  STRIPE_ANNUAL_PRICE_26_50: process.env.STRIPE_ANNUAL_PRICE_26_50,
  STRIPE_ANNUAL_PRICE_51_100: process.env.STRIPE_ANNUAL_PRICE_51_100,
  STRIPE_ONBOARDING_PRICE_1_25: process.env.STRIPE_ONBOARDING_PRICE_1_25,
  STRIPE_ONBOARDING_PRICE_26_100: process.env.STRIPE_ONBOARDING_PRICE_26_100,
};

function setStripePricingEnv() {
  process.env.CP_BILLING_MODE = 'stripe';
  process.env.STRIPE_PILOT_PRICE = 'price_pilot';
  process.env.STRIPE_ANNUAL_PRICE_1_10 = 'price_annual_1_10';
  process.env.STRIPE_ANNUAL_PRICE_11_25 = 'price_annual_11_25';
  process.env.STRIPE_ANNUAL_PRICE_26_50 = 'price_annual_26_50';
  process.env.STRIPE_ANNUAL_PRICE_51_100 = 'price_annual_51_100';
  process.env.STRIPE_ONBOARDING_PRICE_1_25 = 'price_onboarding_1_25';
  process.env.STRIPE_ONBOARDING_PRICE_26_100 = 'price_onboarding_26_100';
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('billing-stripe-pricing.service', () => {
  test('derives Stripe line items for pilot and annual checkout flows', () => {
    setStripePricingEnv();

    const pilotItems = getLineItems({ kind: 'pilot', classrooms: 8 });
    const annualItems = getLineItems({ kind: 'annual', classrooms: 12 });

    assert.deepEqual(pilotItems, [{ price: 'price_pilot', quantity: 1 }]);
    assert.deepEqual(annualItems, [
      { price: 'price_annual_11_25', quantity: 12 },
      { price: 'price_onboarding_1_25', quantity: 1 },
    ]);
  });

  test('uses the upper tiers for larger annual checkouts', () => {
    setStripePricingEnv();

    assert.deepEqual(getLineItems({ kind: 'annual', classrooms: 50 }), [
      { price: 'price_annual_26_50', quantity: 50 },
      { price: 'price_onboarding_26_100', quantity: 1 },
    ]);

    assert.deepEqual(getLineItems({ kind: 'annual', classrooms: 100 }), [
      { price: 'price_annual_51_100', quantity: 100 },
      { price: 'price_onboarding_26_100', quantity: 1 },
    ]);
  });

  test('rejects unsupported classroom counts', () => {
    setStripePricingEnv();

    assert.throws(
      () => getLineItems({ kind: 'annual', classrooms: 101 }),
      /Online checkout is available for up to 100 classrooms/
    );
  });

  test('fails explicitly when a Stripe price is missing', () => {
    setStripePricingEnv();
    delete process.env.STRIPE_PILOT_PRICE;

    assert.throws(() => requireStripePrice(null, 'pilot'), /Stripe price is not configured: pilot/);
    assert.throws(
      () => getLineItems({ kind: 'pilot', classrooms: 1 }),
      /Stripe price is not configured: pilot/
    );
  });
});
