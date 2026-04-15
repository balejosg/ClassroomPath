import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dispatchStripeWebhookEvent } from '../src/services/billing/billing-webhook-event.service.js';

describe('billing-webhook-event.service', () => {
  test('returns false for Stripe events that ClassroomPath does not handle', async () => {
    const handled = await dispatchStripeWebhookEvent({
      id: 'evt_unhandled',
      type: 'charge.succeeded',
      data: { object: {} },
    });

    assert.equal(handled, false);
  });

  test('rejects checkout completion events that omit the checkout session id', async () => {
    await assert.rejects(
      () =>
        dispatchStripeWebhookEvent({
          id: 'evt_checkout_missing_session',
          type: 'checkout.session.completed',
          data: { object: { customer: 'cus_test' } },
        }),
      /Stripe checkout session missing id/
    );
  });
});
