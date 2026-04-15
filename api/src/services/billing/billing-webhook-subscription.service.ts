import { BILLING_GRACE_PERIOD_DAYS, type StripeWebhookEvent } from './billing-types.js';
import { updateEntitlementLifecycleFromStripe } from './billing-store.js';
import { addDays, asStripeRecord, getBoolean, getString, getUnixDate } from './billing-utils.js';

export async function handleSubscriptionWebhookEvent(event: StripeWebhookEvent): Promise<void> {
  const subscription = asStripeRecord(event.data?.object);
  const subscriptionId = getString(subscription, 'id');
  const customerId = getString(subscription, 'customer');
  const subscriptionStatus = getString(subscription, 'status');
  const currentPeriodEnd = getUnixDate(subscription, 'current_period_end');
  const cancelAtPeriodEnd = getBoolean(subscription, 'cancel_at_period_end');

  if (event.type === 'customer.subscription.deleted') {
    await updateEntitlementLifecycleFromStripe({
      eventId: event.id,
      eventType: event.type,
      nextStatus: 'canceled',
      subscriptionId,
      customerId,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });
    return;
  }

  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    await updateEntitlementLifecycleFromStripe({
      eventId: event.id,
      eventType: event.type,
      nextStatus: 'grace_period',
      subscriptionId,
      customerId,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      graceEndsAt: addDays(BILLING_GRACE_PERIOD_DAYS),
    });
    return;
  }

  if (
    subscriptionStatus === 'canceled' ||
    subscriptionStatus === 'incomplete' ||
    subscriptionStatus === 'incomplete_expired'
  ) {
    await updateEntitlementLifecycleFromStripe({
      eventId: event.id,
      eventType: event.type,
      nextStatus: 'canceled',
      subscriptionId,
      customerId,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });
    return;
  }

  await updateEntitlementLifecycleFromStripe({
    eventId: event.id,
    eventType: event.type,
    nextStatus: 'active',
    subscriptionId,
    customerId,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
}
