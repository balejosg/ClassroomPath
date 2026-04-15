import { BILLING_GRACE_PERIOD_DAYS, type StripeWebhookEvent } from './billing-types.js';
import { updateEntitlementLifecycleFromStripe } from './billing-store.js';
import {
  addDays,
  asStripeRecord,
  getString,
  readInvoiceCurrentPeriodEnd,
} from './billing-utils.js';

export async function handleInvoiceWebhookEvent(event: StripeWebhookEvent): Promise<void> {
  const invoice = asStripeRecord(event.data?.object);
  const subscriptionId = getString(invoice, 'subscription');
  const customerId = getString(invoice, 'customer');
  const currentPeriodEnd = readInvoiceCurrentPeriodEnd(invoice);

  if (event.type === 'invoice.paid') {
    await updateEntitlementLifecycleFromStripe({
      eventId: event.id,
      eventType: event.type,
      nextStatus: 'active',
      subscriptionId,
      customerId,
      currentPeriodEnd,
    });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    await updateEntitlementLifecycleFromStripe({
      eventId: event.id,
      eventType: event.type,
      nextStatus: 'grace_period',
      subscriptionId,
      customerId,
      currentPeriodEnd,
      graceEndsAt: addDays(BILLING_GRACE_PERIOD_DAYS),
    });
  }
}
