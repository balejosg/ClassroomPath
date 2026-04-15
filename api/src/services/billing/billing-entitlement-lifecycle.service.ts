import { eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import type { OrganizationEntitlement } from '../../db/schema.js';
import type { BillingEntitlementStatus } from './billing-types.js';
import { effectiveEntitlementStatus, toIso } from './billing-utils.js';
import { recordBillingAuditEvent } from './billing-audit-store.js';

export async function findEntitlementByStripeReference(params: {
  subscriptionId?: string | null;
  customerId?: string | null;
}): Promise<OrganizationEntitlement | null> {
  if (params.subscriptionId) {
    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.stripeSubscriptionId, params.subscriptionId))
      .limit(1);
    if (entitlement) return entitlement;
  }

  if (params.customerId) {
    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.stripeCustomerId, params.customerId))
      .limit(1);
    if (entitlement) return entitlement;
  }

  return null;
}

export async function updateEntitlementLifecycleFromStripe(params: {
  eventId: string;
  eventType: string;
  nextStatus: BillingEntitlementStatus;
  subscriptionId?: string | null;
  customerId?: string | null;
  currentPeriodEnd?: Date | null;
  graceEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean | null;
}): Promise<void> {
  const entitlement = await findEntitlementByStripeReference({
    subscriptionId: params.subscriptionId ?? null,
    customerId: params.customerId ?? null,
  });

  if (!entitlement) {
    throw new Error(`Billing entitlement not found for Stripe event ${params.eventId}`);
  }

  const previousStatus = effectiveEntitlementStatus(entitlement);
  const nextGraceEndsAt =
    params.nextStatus === 'grace_period' ? (params.graceEndsAt ?? null) : null;
  const nextCancelAtPeriodEnd =
    params.nextStatus === 'canceled'
      ? false
      : (params.cancelAtPeriodEnd ?? entitlement.cancelAtPeriodEnd);

  await db
    .update(schema.cpOrganizationEntitlements)
    .set({
      status: params.nextStatus,
      currentPeriodEnd: params.currentPeriodEnd ?? entitlement.currentPeriodEnd ?? null,
      graceEndsAt: nextGraceEndsAt,
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      lastStripeEventType: params.eventType,
      lastStripeEventId: params.eventId,
      updatedAt: new Date(),
    })
    .where(eq(schema.cpOrganizationEntitlements.organizationId, entitlement.organizationId));

  await recordBillingAuditEvent({
    organizationId: entitlement.organizationId,
    actorType: 'stripe',
    actorId: params.customerId ?? params.subscriptionId ?? null,
    action: 'entitlement.status-updated',
    targetType: 'organization_entitlement',
    targetId: entitlement.organizationId,
    metadata: {
      previousStatus,
      nextStatus: params.nextStatus,
      currentPeriodEnd: toIso(params.currentPeriodEnd ?? entitlement.currentPeriodEnd ?? null),
      graceEndsAt: toIso(nextGraceEndsAt),
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      stripeEventId: params.eventId,
      stripeEventType: params.eventType,
    },
  });
}
