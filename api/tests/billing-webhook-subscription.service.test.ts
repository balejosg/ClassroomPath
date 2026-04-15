import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { handleSubscriptionWebhookEvent } from '../src/services/billing/billing-webhook-subscription.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedEntitlement(params: {
  subscriptionId: string;
  customerId: string;
  cancelAtPeriodEnd?: boolean;
}) {
  const organizationId = nextId('org_subscription');
  organizationIds.add(organizationId);

  await db.insert(schema.cpOrganizations).values({
    id: organizationId,
    name: `Org ${organizationId}`,
    createdBy: 'billing-webhook-test',
  });

  await db.insert(schema.cpOrganizationEntitlements).values({
    organizationId,
    source: 'stripe_subscription',
    status: 'active',
    productKind: 'annual',
    classroomLimit: 25,
    stripeCustomerId: params.customerId,
    stripeSubscriptionId: params.subscriptionId,
    stripeCheckoutSessionId: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
    expiresAt: null,
    grantedBy: null,
    lastStripeEventType: null,
    lastStripeEventId: null,
  });

  return organizationId;
}

async function readEntitlement(organizationId: string) {
  const [entitlement] = await db
    .select()
    .from(schema.cpOrganizationEntitlements)
    .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
    .limit(1);
  return entitlement;
}

after(async () => {
  if (organizationIds.size > 0) {
    await db
      .delete(schema.cpOrganizationEntitlements)
      .where(inArray(schema.cpOrganizationEntitlements.organizationId, [...organizationIds]));
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, [...organizationIds]));
  }
});

describe('billing-webhook-subscription.service', { concurrency: 1 }, () => {
  test('marks deleted subscriptions as canceled', async () => {
    const organizationId = await seedEntitlement({
      subscriptionId: 'sub_deleted',
      customerId: 'cus_deleted',
      cancelAtPeriodEnd: true,
    });

    await handleSubscriptionWebhookEvent({
      id: 'evt_subscription_deleted',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_deleted',
          customer: 'cus_deleted',
          status: 'active',
          current_period_end: 1_767_225_600,
          cancel_at_period_end: true,
        },
      },
    });

    const entitlement = await readEntitlement(organizationId);

    assert.equal(entitlement?.status, 'canceled');
    assert.equal(entitlement?.cancelAtPeriodEnd, false);
    assert.equal(entitlement?.lastStripeEventId, 'evt_subscription_deleted');
    assert.equal(entitlement?.currentPeriodEnd?.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  test('moves past-due subscriptions into grace period', async () => {
    const organizationId = await seedEntitlement({
      subscriptionId: 'sub_past_due',
      customerId: 'cus_past_due',
      cancelAtPeriodEnd: true,
    });

    await handleSubscriptionWebhookEvent({
      id: 'evt_subscription_past_due',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_past_due',
          customer: 'cus_past_due',
          status: 'past_due',
          current_period_end: 1_767_312_000,
          cancel_at_period_end: true,
        },
      },
    });

    const entitlement = await readEntitlement(organizationId);

    assert.equal(entitlement?.status, 'grace_period');
    assert.equal(entitlement?.cancelAtPeriodEnd, true);
    assert.equal(entitlement?.lastStripeEventId, 'evt_subscription_past_due');
    assert.ok(entitlement?.graceEndsAt instanceof Date);
  });

  test('cancels incomplete subscriptions and keeps healthy ones active', async () => {
    const incompleteOrganizationId = await seedEntitlement({
      subscriptionId: 'sub_incomplete',
      customerId: 'cus_incomplete',
      cancelAtPeriodEnd: true,
    });
    const activeOrganizationId = await seedEntitlement({
      subscriptionId: 'sub_active',
      customerId: 'cus_active',
      cancelAtPeriodEnd: false,
    });

    await handleSubscriptionWebhookEvent({
      id: 'evt_subscription_incomplete',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_incomplete',
          customer: 'cus_incomplete',
          status: 'incomplete',
          current_period_end: 1_767_398_400,
          cancel_at_period_end: true,
        },
      },
    });

    await handleSubscriptionWebhookEvent({
      id: 'evt_subscription_active',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_active',
          customer: 'cus_active',
          status: 'active',
          current_period_end: 1_767_484_800,
          cancel_at_period_end: false,
        },
      },
    });

    const incompleteEntitlement = await readEntitlement(incompleteOrganizationId);
    const activeEntitlement = await readEntitlement(activeOrganizationId);

    assert.equal(incompleteEntitlement?.status, 'canceled');
    assert.equal(incompleteEntitlement?.cancelAtPeriodEnd, false);
    assert.equal(activeEntitlement?.status, 'active');
    assert.equal(activeEntitlement?.cancelAtPeriodEnd, false);
    assert.equal(activeEntitlement?.currentPeriodEnd?.toISOString(), '2026-01-04T00:00:00.000Z');
  });
});
