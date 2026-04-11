const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.CP_ALLOW_SELF_SERVICE_ORGS = 'false';
process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.test';
process.env.STRIPE_SECRET_KEY = 'sk_test_classroompath';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_classroompath';
process.env.STRIPE_ANNUAL_PRICE_1_10 = 'price_annual_1_10';
process.env.STRIPE_ANNUAL_PRICE_11_25 = 'price_annual_11_25';
process.env.STRIPE_ANNUAL_PRICE_26_50 = 'price_annual_26_50';
process.env.STRIPE_ANNUAL_PRICE_51_100 = 'price_annual_51_100';
process.env.STRIPE_ONBOARDING_PRICE_1_25 = 'price_onboarding_1_25';
process.env.STRIPE_ONBOARDING_PRICE_26_100 = 'price_onboarding_26_100';
process.env.STRIPE_PILOT_PRICE = 'price_pilot';

import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, schema } from '../../src/db/index.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import {
  assertStatus,
  bearerAuth,
  parseTRPC,
  resetDb,
  trpcMutate,
  trpcQuery,
  uniqueEmail,
} from '../test-utils.js';
import { ensureOpenPathUser, signToken, useIntegrationServer } from './harness.js';

const integration = useIntegrationServer({ resetBeforeStart: true });
const originalFetch = globalThis.fetch.bind(globalThis);

function stripeSignature(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET ?? '')
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

async function issueToken(params: {
  userId: string;
  email: string;
  name?: string;
  roles?: Array<{ role: string; groupIds: string[] }>;
}) {
  await ensureOpenPathUser({
    userId: params.userId,
    email: params.email,
    name: params.name ?? 'Billing Test User',
  });

  return signToken({
    jwtSecret: JWT_SECRET,
    userId: params.userId,
    email: params.email,
    name: params.name ?? 'Billing Test User',
    roles: params.roles ?? [],
  });
}

describe('ClassroomPath billing integration', { concurrency: 1 }, () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('blocks free self-service organization creation before checkout', async () => {
    const token = await issueToken({
      userId: 'billing-free-create',
      email: uniqueEmail('billing-free-create'),
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Unpaid Org' },
      bearerAuth(token)
    );

    assert.equal(response.status, 403);
    const parsed = await parseTRPC(response);
    assert.equal(parsed.error, 'Billing checkout required before creating an organization');
  });

  test('creates an annual checkout session with recurring and onboarding price IDs', async () => {
    const token = await issueToken({
      userId: 'billing-checkout',
      email: uniqueEmail('billing-checkout'),
    });
    const requests: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        requests.push({ url, body: String(init?.body ?? '') });
        return new Response(
          JSON.stringify({ id: 'cs_test_annual', url: 'https://checkout.stripe.test/session' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    const response = await trpcMutate(
      integration.baseUrl,
      'billing.createCheckout',
      { kind: 'annual', organizationName: 'Paid Org', classrooms: 12 },
      bearerAuth(token)
    );

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as {
      data?: { checkoutUrl?: string; checkoutSessionId?: string };
    };
    assert.equal(parsed.data?.checkoutUrl, 'https://checkout.stripe.test/session');
    assert.equal(parsed.data?.checkoutSessionId, 'cs_test_annual');
    assert.equal(requests.length, 1);
    assert.match(requests[0].body, /mode=subscription/);
    assert.match(requests[0].body, /line_items%5B0%5D%5Bprice%5D=price_annual_11_25/);
    assert.match(requests[0].body, /line_items%5B1%5D%5Bprice%5D=price_onboarding_1_25/);
  });

  test('activates an organization entitlement from a completed checkout webhook', async () => {
    const userId = 'billing-webhook-user';
    const token = await issueToken({
      userId,
      email: uniqueEmail('billing-webhook'),
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({ id: 'cs_test_paid', url: 'https://checkout.stripe.test/paid' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    await trpcMutate(
      integration.baseUrl,
      'billing.createCheckout',
      { kind: 'annual', organizationName: 'Webhook Paid Org', classrooms: 12 },
      bearerAuth(token)
    );

    const payload = JSON.stringify({
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_paid',
          customer: 'cus_test_paid',
          subscription: 'sub_test_paid',
          payment_status: 'paid',
        },
      },
    });

    const webhookResponse = await fetch(`${integration.baseUrl}/cp/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': stripeSignature(payload),
      },
      body: payload,
    });

    assertStatus(webhookResponse, 200);

    const [membership] = await db
      .select()
      .from(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, userId))
      .limit(1);
    assert.equal(membership?.role, 'admin');

    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.organizationId, membership.organizationId))
      .limit(1);
    assert.equal(entitlement?.status, 'active');
    assert.equal(entitlement?.source, 'stripe_subscription');
    assert.equal(entitlement?.classroomLimit, 12);

    const [role] = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, userId))
      .limit(1);
    assert.equal(role?.role, 'admin');

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(statusResponse, 200);
    const status = (await parseTRPC(statusResponse)) as {
      data?: { hasMembership?: boolean; billing?: { hasActiveEntitlement?: boolean } };
    };
    assert.equal(status.data?.hasMembership, true);
    assert.equal(status.data?.billing?.hasActiveEntitlement, true);
  });

  test('activates an existing organization entitlement from checkout', async () => {
    const userId = 'billing-existing-user';
    const organizationId = 'billing-existing-org';
    const token = await issueToken({
      userId,
      email: uniqueEmail('billing-existing'),
    });

    await db.insert(schema.cpOrganizations).values({
      id: organizationId,
      name: 'Existing Unpaid Org',
      createdBy: userId,
    });
    await db.insert(schema.cpMemberships).values({
      id: 'billing-existing-membership',
      userId,
      organizationId,
      role: 'admin',
      invitedBy: null,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        assert.match(String(init?.body ?? ''), /metadata%5BorganizationId%5D=billing-existing-org/);
        return new Response(
          JSON.stringify({
            id: 'cs_test_existing_paid',
            url: 'https://checkout.stripe.test/existing-paid',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    await trpcMutate(
      integration.baseUrl,
      'billing.createCheckout',
      { kind: 'annual', organizationName: 'Ignored New Org Name', classrooms: 8 },
      bearerAuth(token)
    );

    const payload = JSON.stringify({
      id: 'evt_checkout_completed_existing',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_existing_paid',
          customer: 'cus_test_existing_paid',
          subscription: 'sub_test_existing_paid',
          payment_status: 'paid',
        },
      },
    });

    const webhookResponse = await fetch(`${integration.baseUrl}/cp/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': stripeSignature(payload),
      },
      body: payload,
    });
    assertStatus(webhookResponse, 200);

    const memberships = await db
      .select()
      .from(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, userId));
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0]?.organizationId, organizationId);

    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
      .limit(1);
    assert.equal(entitlement?.status, 'active');
    assert.equal(entitlement?.source, 'stripe_subscription');
    assert.equal(entitlement?.classroomLimit, 8);
  });

  test('moves subscription billing through grace period and cancellation via Stripe webhooks', async () => {
    const userId = 'billing-lifecycle-user';
    const token = await issueToken({
      userId,
      email: uniqueEmail('billing-lifecycle'),
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({
            id: 'cs_test_lifecycle',
            url: 'https://checkout.stripe.test/lifecycle',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    await trpcMutate(
      integration.baseUrl,
      'billing.createCheckout',
      { kind: 'annual', organizationName: 'Lifecycle Org', classrooms: 12 },
      bearerAuth(token)
    );

    const completedPayload = JSON.stringify({
      id: 'evt_checkout_lifecycle',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_lifecycle',
          customer: 'cus_test_lifecycle',
          subscription: 'sub_test_lifecycle',
          payment_status: 'paid',
        },
      },
    });

    const failedInvoicePayload = JSON.stringify({
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: 'cus_test_lifecycle',
          subscription: 'sub_test_lifecycle',
          period_end: Math.floor(Date.now() / 1000) + 86400,
        },
      },
    });

    const deletedSubscriptionPayload = JSON.stringify({
      id: 'evt_subscription_deleted',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_lifecycle',
          customer: 'cus_test_lifecycle',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
        },
      },
    });

    for (const payload of [completedPayload, failedInvoicePayload, deletedSubscriptionPayload]) {
      const webhookResponse = await fetch(`${integration.baseUrl}/cp/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': stripeSignature(payload),
        },
        body: payload,
      });
      assertStatus(webhookResponse, 200);
    }

    const [membership] = await db
      .select()
      .from(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, userId))
      .limit(1);

    const [entitlement] = await db
      .select()
      .from(schema.cpOrganizationEntitlements)
      .where(eq(schema.cpOrganizationEntitlements.organizationId, membership.organizationId))
      .limit(1);

    assert.equal(entitlement?.status, 'canceled');
    assert.equal(entitlement?.lastStripeEventType, 'customer.subscription.deleted');

    const auditTrailResponse = await trpcQuery(
      integration.baseUrl,
      'billing.getAuditTrail',
      { organizationId: membership.organizationId },
      bearerAuth(
        await issueToken({
          userId: 'billing-lifecycle-admin',
          email: 'ops@classroompath.test',
        })
      )
    );
    assertStatus(auditTrailResponse, 200);
    const auditTrail = (await parseTRPC(auditTrailResponse)) as {
      data?: Array<{ action?: string; metadata?: { nextStatus?: string } }>;
    };
    assert.ok(auditTrail.data?.some((entry) => entry.metadata?.nextStatus === 'grace_period'));
    assert.ok(auditTrail.data?.some((entry) => entry.metadata?.nextStatus === 'canceled'));

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(statusResponse, 200);
    const status = (await parseTRPC(statusResponse)) as {
      data?: { billing?: { hasActiveEntitlement?: boolean; status?: string | null } };
    };
    assert.equal(status.data?.billing?.hasActiveEntitlement, false);
    assert.equal(status.data?.billing?.status, 'canceled');
  });

  test('rejects manual billing requests with an audit trail entry', async () => {
    const adminToken = await issueToken({
      userId: 'billing-platform-admin-reject',
      email: 'ops@classroompath.test',
    });
    const requesterToken = await issueToken({
      userId: 'billing-manual-reject-requester',
      email: uniqueEmail('billing-manual-reject'),
    });

    const requestResponse = await trpcMutate(
      integration.baseUrl,
      'billing.createManualRequest',
      {
        kind: 'custom_quote',
        organizationName: 'Rejected School',
        classrooms: 18,
        note: 'Pendiente de presupuesto institucional',
      },
      bearerAuth(requesterToken)
    );
    assertStatus(requestResponse, 200);
    const requestParsed = (await parseTRPC(requestResponse)) as { data?: { requestId?: string } };
    assert.ok(requestParsed.data?.requestId);

    const rejectResponse = await trpcMutate(
      integration.baseUrl,
      'billing.rejectManualRequest',
      { requestId: requestParsed.data.requestId, resolutionNote: 'Falta documentación' },
      bearerAuth(adminToken)
    );
    assertStatus(rejectResponse, 200);

    const requestsResponse = await trpcQuery(
      integration.baseUrl,
      'billing.listManualRequests',
      undefined,
      bearerAuth(adminToken)
    );
    assertStatus(requestsResponse, 200);
    const requestsParsed = (await parseTRPC(requestsResponse)) as {
      data?: Array<{ id: string; status: string; resolutionNote?: string | null }>;
    };
    const rejectedRequest = requestsParsed.data?.find(
      (request) => request.id === requestParsed.data?.requestId
    );
    assert.equal(rejectedRequest?.status, 'rejected');
    assert.equal(rejectedRequest?.resolutionNote, 'Falta documentación');

    const auditTrailResponse = await trpcQuery(
      integration.baseUrl,
      'billing.getAuditTrail',
      { requestId: requestParsed.data.requestId },
      bearerAuth(adminToken)
    );
    assertStatus(auditTrailResponse, 200);
    const auditTrail = (await parseTRPC(auditTrailResponse)) as {
      data?: Array<{ action?: string }>;
    };
    assert.ok(auditTrail.data?.some((entry) => entry.action === 'manual-request.rejected'));
  });

  test('allows platform admins to approve a public campaign exception', async () => {
    const adminToken = await issueToken({
      userId: 'billing-platform-admin',
      email: 'ops@classroompath.test',
    });
    const requesterToken = await issueToken({
      userId: 'billing-public-requester',
      email: uniqueEmail('billing-public'),
    });

    const requestResponse = await trpcMutate(
      integration.baseUrl,
      'billing.createManualRequest',
      {
        kind: 'public_campaign',
        organizationName: 'Public Campaign School',
        classrooms: 5,
        note: 'Centro publico verificado fuera de Stripe',
      },
      bearerAuth(requesterToken)
    );
    assertStatus(requestResponse, 200);
    const requestParsed = (await parseTRPC(requestResponse)) as { data?: { requestId?: string } };
    assert.ok(requestParsed.data?.requestId);

    const approveResponse = await trpcMutate(
      integration.baseUrl,
      'billing.approveManualRequest',
      { requestId: requestParsed.data.requestId, resolutionNote: 'Excepción aprobada por soporte' },
      bearerAuth(adminToken)
    );
    assertStatus(approveResponse, 200);

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(requesterToken)
    );
    assertStatus(statusResponse, 200);
    const status = (await parseTRPC(statusResponse)) as {
      data?: {
        hasMembership?: boolean;
        billing?: { source?: string; hasActiveEntitlement?: boolean };
      };
    };
    assert.equal(status.data?.hasMembership, true);
    assert.equal(status.data?.billing?.hasActiveEntitlement, true);
    assert.equal(status.data?.billing?.source, 'manual');
  });
});
