import { eq } from 'drizzle-orm';

import { config } from '../../config.js';
import { db, schema } from '../../db/index.js';
import { generateId } from '../../lib/id.js';
import { BILLING_AUDIT_TARGET_CHECKOUT, type CheckoutRequest } from './billing-types.js';
import {
  assertClassroomCount,
  assertStripeBillingEnabled,
  createStripeCheckoutSession,
  formEncodeCheckout,
  getLineItems,
} from './billing-utils.js';
import { getExistingBillingOrganization, recordBillingAuditEvent } from './billing-store.js';

export async function createBillingCheckout(input: CheckoutRequest): Promise<{
  checkoutSessionId: string;
  checkoutUrl: string;
}> {
  assertStripeBillingEnabled();
  assertClassroomCount(input.classrooms);

  const existingOrganization = await getExistingBillingOrganization(input.userId);
  const intentId = generateId('bill');
  const lineItems = getLineItems({ kind: input.kind, classrooms: input.classrooms });
  const session = await createStripeCheckoutSession(
    formEncodeCheckout({
      mode: input.kind === 'annual' ? 'subscription' : 'payment',
      lineItems,
      successUrl: `${config.publicUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.publicUrl}/billing/cancel`,
      clientReferenceId: intentId,
      email: input.email,
      metadata: {
        billingIntentId: intentId,
        userId: input.userId,
        organizationId: existingOrganization?.id ?? '',
        organizationName: existingOrganization?.name ?? input.organizationName,
        kind: input.kind,
        classrooms: String(input.classrooms),
      },
    })
  );

  await db.insert(schema.cpBillingCheckoutIntents).values({
    id: intentId,
    userId: input.userId,
    organizationId: existingOrganization?.id ?? null,
    organizationName: existingOrganization?.name ?? input.organizationName,
    classrooms: input.classrooms,
    kind: input.kind,
    status: 'pending',
    stripeCheckoutSessionId: session.id,
  });

  await recordBillingAuditEvent({
    organizationId: existingOrganization?.id ?? null,
    actorType: 'user',
    actorId: input.userId,
    action: 'checkout.created',
    targetType: BILLING_AUDIT_TARGET_CHECKOUT,
    targetId: intentId,
    metadata: {
      kind: input.kind,
      classrooms: input.classrooms,
      stripeCheckoutSessionId: session.id,
    },
  });

  return {
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
  };
}
