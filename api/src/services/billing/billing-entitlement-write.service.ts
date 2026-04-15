import { eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import { generateId } from '../../lib/id.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';
import type { EntitlementWriteParams } from './billing-types.js';

export async function upsertOrganizationEntitlement(params: EntitlementWriteParams): Promise<void> {
  await db
    .insert(schema.cpOrganizationEntitlements)
    .values({
      organizationId: params.organizationId,
      source: params.source,
      status: params.status,
      productKind: params.productKind,
      classroomLimit: params.classrooms,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      currentPeriodEnd: params.currentPeriodEnd ?? null,
      graceEndsAt: params.graceEndsAt ?? null,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
      lastStripeEventType: params.lastStripeEventType ?? null,
      lastStripeEventId: params.lastStripeEventId ?? null,
      expiresAt: params.expiresAt ?? null,
      grantedBy: params.grantedBy ?? null,
    })
    .onConflictDoUpdate({
      target: schema.cpOrganizationEntitlements.organizationId,
      set: {
        source: params.source,
        status: params.status,
        productKind: params.productKind,
        classroomLimit: params.classrooms,
        stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
        stripeCustomerId: params.stripeCustomerId ?? null,
        stripeSubscriptionId: params.stripeSubscriptionId ?? null,
        currentPeriodEnd: params.currentPeriodEnd ?? null,
        graceEndsAt: params.graceEndsAt ?? null,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        lastStripeEventType: params.lastStripeEventType ?? null,
        lastStripeEventId: params.lastStripeEventId ?? null,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function activateExistingOrganizationEntitlement(params: {
  userId: string;
  organizationId: string;
  source: 'stripe_subscription' | 'stripe_payment' | 'manual';
  productKind: string;
  classrooms: number;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  graceEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  expiresAt?: Date | null;
  grantedBy?: string | null;
  lastStripeEventType?: string | null;
  lastStripeEventId?: string | null;
}): Promise<{ organizationId: string }> {
  await upsertOrganizationEntitlement({
    organizationId: params.organizationId,
    source: params.source,
    status: 'active',
    productKind: params.productKind,
    classrooms: params.classrooms,
    stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    stripeCustomerId: params.stripeCustomerId ?? null,
    stripeSubscriptionId: params.stripeSubscriptionId ?? null,
    currentPeriodEnd: params.currentPeriodEnd ?? null,
    graceEndsAt: params.graceEndsAt ?? null,
    cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
    expiresAt: params.expiresAt ?? null,
    grantedBy: params.grantedBy ?? null,
    lastStripeEventType: params.lastStripeEventType ?? null,
    lastStripeEventId: params.lastStripeEventId ?? null,
  });

  await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.grantedBy ?? params.userId,
  });

  return { organizationId: params.organizationId };
}

export async function createOrganizationWithEntitlement(params: {
  userId: string;
  organizationName: string;
  source: 'stripe_subscription' | 'stripe_payment' | 'manual';
  productKind: string;
  classrooms: number;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  grantedBy?: string | null;
  currentPeriodEnd?: Date | null;
  graceEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  expiresAt?: Date | null;
  lastStripeEventType?: string | null;
  lastStripeEventId?: string | null;
}): Promise<{ organizationId: string; membershipId: string }> {
  const orgId = generateId('org');
  const membershipId = generateId('mem');

  await db.transaction(async (tx) => {
    await tx.insert(schema.cpOrganizations).values({
      id: orgId,
      name: params.organizationName,
      createdBy: params.userId,
    });

    await tx.insert(schema.cpMemberships).values({
      id: membershipId,
      userId: params.userId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: null,
    });

    await tx.insert(schema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: params.source,
      status: 'active',
      productKind: params.productKind,
      classroomLimit: params.classrooms,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      currentPeriodEnd: params.currentPeriodEnd ?? null,
      graceEndsAt: params.graceEndsAt ?? null,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
      lastStripeEventType: params.lastStripeEventType ?? null,
      lastStripeEventId: params.lastStripeEventId ?? null,
      expiresAt: params.expiresAt ?? null,
      grantedBy: params.grantedBy ?? null,
    });
  });

  await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.grantedBy ?? params.userId,
  });

  return { organizationId: orgId, membershipId };
}
