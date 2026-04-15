import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { processStripeWebhook } from '../src/services/billing/billing-webhooks.js';

const originalBillingMode = process.env.CP_BILLING_MODE;
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (originalBillingMode === undefined) {
    delete process.env.CP_BILLING_MODE;
  } else {
    process.env.CP_BILLING_MODE = originalBillingMode;
  }

  if (originalWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

void describe('billing-webhooks', () => {
  void test('treats webhooks as a no-op when stripe billing is disabled', async () => {
    process.env.CP_BILLING_MODE = 'manual_only';

    await processStripeWebhook({
      rawBody: Buffer.from('{}'),
      signature: undefined,
    });
  });

  void test('rejects stripe-mode webhooks when the signature is missing', async () => {
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    await assert.rejects(
      () =>
        processStripeWebhook({
          rawBody: Buffer.from('{}'),
          signature: undefined,
        }),
      /Missing Stripe signature/
    );
  });
});
