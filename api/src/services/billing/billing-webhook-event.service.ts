import type { StripeWebhookEvent } from './billing-types.js';
import { completeStripeCheckoutSession } from './billing-webhook-checkout.service.js';
import { handleInvoiceWebhookEvent } from './billing-webhook-invoice.service.js';
import { handleSubscriptionWebhookEvent } from './billing-webhook-subscription.service.js';

export async function dispatchStripeWebhookEvent(event: StripeWebhookEvent): Promise<boolean> {
  if (event.type === 'checkout.session.completed') {
    await completeStripeCheckoutSession(event);
    return true;
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    await handleInvoiceWebhookEvent(event);
    return true;
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleSubscriptionWebhookEvent(event);
    return true;
  }

  return false;
}
