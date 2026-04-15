import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBillingCheckout } from '../src/services/billing/billing-checkout.js';

const originalBillingMode = process.env.CP_BILLING_MODE;

afterEach(() => {
  if (originalBillingMode === undefined) {
    delete process.env.CP_BILLING_MODE;
    return;
  }

  process.env.CP_BILLING_MODE = originalBillingMode;
});

void describe('billing-checkout', () => {
  void test('fails closed when online checkout is disabled', async () => {
    process.env.CP_BILLING_MODE = 'manual_only';

    await assert.rejects(
      () =>
        createBillingCheckout({
          userId: 'user_checkout',
          email: 'checkout@example.com',
          organizationName: 'Checkout Org',
          classrooms: 10,
          kind: 'annual',
        }),
      /Online checkout is not available/
    );
  });
});
