import { eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import {
  BILLING_AUDIT_TARGET_CHECKOUT,
  BILLING_AUDIT_TARGET_ENTITLEMENT,
  PILOT_DURATION_DAYS,
  type StripeWebhookEvent,
} from './billing-types.js';
import {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  recordBillingAuditEvent,
} from './billing-store.js';
import { addDays, asStripeRecord, getString, toIso } from './billing-utils.js';

export async function completeStripeCheckoutSession(event: StripeWebhookEvent): Promise<void> {
  const session = asStripeRecord(event.data?.object);
  const sessionId = getString(session, 'id');
  if (!sessionId) {
    throw new Error('Stripe checkout session missing id');
  }

  const [intent] = await db
    .select()
    .from(schema.cpBillingCheckoutIntents)
    .where(eq(schema.cpBillingCheckoutIntents.stripeCheckoutSessionId, sessionId))
    .limit(1);

  if (!intent) {
    throw new Error(`Billing checkout intent not found for session ${sessionId}`);
  }

  if (intent.status === 'completed' && intent.organizationId) return;

  const stripeCustomerId = getString(session, 'customer');
  const stripeSubscriptionId = getString(session, 'subscription');
  const stripePaymentIntentId = getString(session, 'payment_intent');
  const expiresAt = intent.kind === 'pilot' ? addDays(PILOT_DURATION_DAYS) : null;

  const result = intent.organizationId
    ? await activateExistingOrganizationEntitlement({
        userId: intent.userId,
        organizationId: intent.organizationId,
        classrooms: intent.classrooms,
        source: intent.kind === 'annual' ? 'stripe_subscription' : 'stripe_payment',
        productKind: intent.kind,
        stripeCheckoutSessionId: sessionId,
        stripeCustomerId,
        stripeSubscriptionId,
        expiresAt,
        lastStripeEventType: event.type,
        lastStripeEventId: event.id,
      })
    : await createOrganizationWithEntitlement({
        userId: intent.userId,
        organizationName: intent.organizationName,
        classrooms: intent.classrooms,
        source: intent.kind === 'annual' ? 'stripe_subscription' : 'stripe_payment',
        productKind: intent.kind,
        stripeCheckoutSessionId: sessionId,
        stripeCustomerId,
        stripeSubscriptionId,
        expiresAt,
        lastStripeEventType: event.type,
        lastStripeEventId: event.id,
      });

  await db
    .update(schema.cpBillingCheckoutIntents)
    .set({
      status: 'completed',
      organizationId: result.organizationId,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePaymentIntentId,
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingCheckoutIntents.id, intent.id));

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'stripe',
    actorId: stripeCustomerId ?? null,
    action: 'checkout.completed',
    targetType: BILLING_AUDIT_TARGET_CHECKOUT,
    targetId: intent.id,
    metadata: {
      stripeCheckoutSessionId: sessionId,
      stripeSubscriptionId,
      stripePaymentIntentId,
      stripeEventId: event.id,
      stripeEventType: event.type,
    },
  });

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'stripe',
    actorId: stripeCustomerId ?? null,
    action: 'entitlement.activated',
    targetType: BILLING_AUDIT_TARGET_ENTITLEMENT,
    targetId: result.organizationId,
    metadata: {
      source: intent.kind === 'annual' ? 'stripe_subscription' : 'stripe_payment',
      productKind: intent.kind,
      classrooms: intent.classrooms,
      expiresAt: toIso(expiresAt),
      stripeCheckoutSessionId: sessionId,
      stripeSubscriptionId,
      stripeEventId: event.id,
      stripeEventType: event.type,
    },
  });
}
