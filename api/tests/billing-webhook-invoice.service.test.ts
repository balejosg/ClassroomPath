import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { handleInvoiceWebhookEvent } from '../src/services/billing/billing-webhook-invoice.service.js';

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
  status?: 'active' | 'grace_period';
}) {
  const organizationId = nextId('org_invoice');
  organizationIds.add(organizationId);

  await db.insert(schema.cpOrganizations).values({
    id: organizationId,
    name: `Org ${organizationId}`,
    createdBy: 'billing-webhook-test',
  });

  await db.insert(schema.cpOrganizationEntitlements).values({
    organizationId,
    source: 'stripe_subscription',
    status: params.status ?? 'active',
    productKind: 'annual',
    classroomLimit: 25,
    stripeCustomerId: params.customerId,
    stripeSubscriptionId: params.subscriptionId,
    stripeCheckoutSessionId: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    expiresAt: null,
    grantedBy: null,
    lastStripeEventType: null,
    lastStripeEventId: null,
  });

  return organizationId;
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

describe('billing-webhook-invoice.service', { concurrency: 1 }, () => {
  test('marks invoice.paid entitlements as active', async () => {
    const organizationId = await seedEntitlement({
      subscriptionId: 'sub_invoice_paid',
      customerId: 'cus_invoice_paid',
      status: 'grace_period',
    });

    await handleInvoiceWebhookEvent({
      id: 'evt_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_invoice_paid',
          customer: 'cus_invoice_paid',
          period_end: 1_767_225_600,
        },
      },
    });

    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
      .limit(1);

    assert.equal(entitlement?.status, 'active');
    assert.equal(entitlement?.lastStripeEventId, 'evt_invoice_paid');
    assert.equal(entitlement?.lastStripeEventType, 'invoice.paid');
    assert.equal(entitlement?.currentPeriodEnd?.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(entitlement?.graceEndsAt, null);
  });

  test('moves failed invoices into grace period using line period fallback', async () => {
    const organizationId = await seedEntitlement({
      subscriptionId: 'sub_invoice_failed',
      customerId: 'cus_invoice_failed',
    });

    await handleInvoiceWebhookEvent({
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_invoice_failed',
          customer: 'cus_invoice_failed',
          lines: {
            data: [{ period: { end: 1_767_312_000 } }],
          },
        },
      },
    });

    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
      .limit(1);

    assert.equal(entitlement?.status, 'grace_period');
    assert.equal(entitlement?.lastStripeEventId, 'evt_invoice_failed');
    assert.equal(entitlement?.lastStripeEventType, 'invoice.payment_failed');
    assert.equal(entitlement?.currentPeriodEnd?.toISOString(), '2026-01-02T00:00:00.000Z');
    assert.ok(entitlement?.graceEndsAt instanceof Date);
  });
});
