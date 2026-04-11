import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import type { OrganizationEntitlement } from '../db/schema.js';

type CheckoutKind = 'annual' | 'pilot';
type ManualRequestKind = 'public_campaign' | 'custom_quote';

export interface BillingStatusDto {
  hasActiveEntitlement: boolean;
  source: string | null;
  status: string | null;
  productKind: string | null;
  classroomLimit: number | null;
  expiresAt: string | null;
}

interface CheckoutRequest {
  userId: string;
  email: string;
  organizationName: string;
  classrooms: number;
  kind: CheckoutKind;
}

interface ManualRequest {
  userId: string;
  organizationName: string;
  classrooms: number;
  kind: ManualRequestKind;
  note?: string;
}

interface StripeSessionObject {
  id?: string;
  customer?: string;
  subscription?: string;
  payment_intent?: string;
  payment_status?: string;
}

interface StripeWebhookEvent {
  id: string;
  type: string;
  data?: { object?: StripeSessionObject };
}

function assertClassroomCount(classrooms: number): void {
  if (!Number.isInteger(classrooms) || classrooms < 1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom count must be positive' });
  }
}

function annualTierKey(classrooms: number): keyof typeof config.stripe.priceIds.annual {
  if (classrooms <= 10) return '1_10';
  if (classrooms <= 25) return '11_25';
  if (classrooms <= 50) return '26_50';
  if (classrooms <= 100) return '51_100';
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Online checkout is available for up to 100 classrooms',
  });
}

function onboardingTierKey(classrooms: number): keyof typeof config.stripe.priceIds.onboarding {
  if (classrooms <= 25) return '1_25';
  if (classrooms <= 100) return '26_100';
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Online checkout is available for up to 100 classrooms',
  });
}

function requireStripePrice(price: string | null, label: string): string {
  if (!price) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Stripe price is not configured: ${label}`,
    });
  }

  return price;
}

function requireStripeSecret(): string {
  const secret = config.stripe.secretKey;
  if (!secret) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Stripe checkout is not configured',
    });
  }

  return secret;
}

function getLineItems(input: { kind: CheckoutKind; classrooms: number }): Array<{
  price: string;
  quantity: number;
}> {
  if (input.kind === 'pilot') {
    return [{ price: requireStripePrice(config.stripe.priceIds.pilot, 'pilot'), quantity: 1 }];
  }

  const annualKey = annualTierKey(input.classrooms);
  const onboardingKey = onboardingTierKey(input.classrooms);

  return [
    {
      price: requireStripePrice(config.stripe.priceIds.annual[annualKey], `annual.${annualKey}`),
      quantity: input.classrooms,
    },
    {
      price: requireStripePrice(
        config.stripe.priceIds.onboarding[onboardingKey],
        `onboarding.${onboardingKey}`
      ),
      quantity: 1,
    },
  ];
}

function formEncodeCheckout(input: {
  mode: 'payment' | 'subscription';
  lineItems: Array<{ price: string; quantity: number }>;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  email: string;
  metadata: Record<string, string>;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set('mode', input.mode);
  body.set('success_url', input.successUrl);
  body.set('cancel_url', input.cancelUrl);
  body.set('client_reference_id', input.clientReferenceId);
  body.set('customer_email', input.email);
  body.set('automatic_tax[enabled]', 'true');
  body.set('billing_address_collection', 'required');
  body.set('tax_id_collection[enabled]', 'true');

  input.lineItems.forEach((item, index) => {
    body.set(`line_items[${index}][price]`, item.price);
    body.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
  }

  return body;
}

async function createStripeCheckoutSession(body: URLSearchParams): Promise<{
  id: string;
  url: string;
}> {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireStripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: unknown;
    url?: unknown;
    error?: { message?: unknown };
  } | null;

  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : 'Stripe checkout session failed',
    });
  }

  if (typeof payload?.id !== 'string' || typeof payload.url !== 'string') {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'Invalid Stripe checkout session payload',
    });
  }

  return { id: payload.id, url: payload.url };
}

export async function createBillingCheckout(input: CheckoutRequest): Promise<{
  checkoutSessionId: string;
  checkoutUrl: string;
}> {
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

  return {
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
  };
}

export function isPlatformAdminEmail(email: string): boolean {
  return config.platformAdminEmails.includes(email.trim().toLowerCase());
}

export function assertPlatformAdmin(user: { email: string }): void {
  if (!isPlatformAdminEmail(user.email)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
  }
}

function isActiveEntitlement(entitlement: OrganizationEntitlement | null): boolean {
  if (!entitlement || entitlement.status !== 'active') return false;
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export function toBillingStatusDto(entitlement: OrganizationEntitlement | null): BillingStatusDto {
  return {
    hasActiveEntitlement: isActiveEntitlement(entitlement),
    source: entitlement?.source ?? null,
    status: entitlement?.status ?? null,
    productKind: entitlement?.productKind ?? null,
    classroomLimit: entitlement?.classroomLimit ?? null,
    expiresAt: entitlement?.expiresAt?.toISOString() ?? null,
  };
}

export async function getOrganizationBillingStatus(
  organizationId: string
): Promise<BillingStatusDto> {
  const [entitlement] = await db
    .select()
    .from(schema.cpOrganizationEntitlements)
    .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
    .limit(1);

  return toBillingStatusDto(entitlement ?? null);
}

export async function assertOrganizationEntitled(organizationId: string): Promise<void> {
  const status = await getOrganizationBillingStatus(organizationId);
  if (!status.hasActiveEntitlement) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Active billing required' });
  }
}

async function getExistingBillingOrganization(
  userId: string
): Promise<{ id: string; name: string } | null> {
  const membership = await getSingleMembershipOrThrow(userId);
  if (!membership) return null;

  const [organization] = await db
    .select({
      id: schema.cpOrganizations.id,
      name: schema.cpOrganizations.name,
    })
    .from(schema.cpOrganizations)
    .where(eq(schema.cpOrganizations.id, membership.organizationId))
    .limit(1);

  return {
    id: membership.organizationId,
    name: organization?.name ?? membership.organizationId,
  };
}

async function activateExistingOrganizationEntitlement(params: {
  userId: string;
  organizationId: string;
  classrooms: number;
  source: 'stripe_subscription' | 'stripe_payment' | 'manual';
  productKind: string;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  grantedBy?: string | null;
  expiresAt?: Date | null;
}): Promise<{ organizationId: string }> {
  await db
    .insert(schema.cpOrganizationEntitlements)
    .values({
      organizationId: params.organizationId,
      source: params.source,
      status: 'active',
      productKind: params.productKind,
      classroomLimit: params.classrooms,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      expiresAt: params.expiresAt ?? null,
      grantedBy: params.grantedBy ?? null,
    })
    .onConflictDoUpdate({
      target: schema.cpOrganizationEntitlements.organizationId,
      set: {
        source: params.source,
        status: 'active',
        productKind: params.productKind,
        classroomLimit: params.classrooms,
        stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
        stripeCustomerId: params.stripeCustomerId ?? null,
        stripeSubscriptionId: params.stripeSubscriptionId ?? null,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
        updatedAt: new Date(),
      },
    });

  await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.grantedBy ?? params.userId,
  });

  return { organizationId: params.organizationId };
}

async function createOrganizationWithEntitlement(params: {
  userId: string;
  organizationName: string;
  classrooms: number;
  source: 'stripe_subscription' | 'stripe_payment' | 'manual';
  productKind: string;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePaymentIntentId?: string | null;
  grantedBy?: string | null;
  expiresAt?: Date | null;
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

export async function createManualBillingRequest(input: ManualRequest): Promise<{
  requestId: string;
}> {
  assertClassroomCount(input.classrooms);
  const requestId = generateId('bill_req');
  const existingOrganization = await getExistingBillingOrganization(input.userId);

  await db.insert(schema.cpBillingManualRequests).values({
    id: requestId,
    userId: input.userId,
    organizationId: existingOrganization?.id ?? null,
    organizationName: existingOrganization?.name ?? input.organizationName,
    kind: input.kind,
    classrooms: input.classrooms,
    status: 'pending',
    note: input.note ?? null,
  });

  return { requestId };
}

export async function listManualBillingRequests(): Promise<
  Array<typeof schema.cpBillingManualRequests.$inferSelect>
> {
  return db.select().from(schema.cpBillingManualRequests);
}

export async function approveManualBillingRequest(params: {
  requestId: string;
  reviewedBy: string;
}): Promise<{ organizationId: string }> {
  const [request] = await db
    .select()
    .from(schema.cpBillingManualRequests)
    .where(
      and(
        eq(schema.cpBillingManualRequests.id, params.requestId),
        eq(schema.cpBillingManualRequests.status, 'pending')
      )
    )
    .limit(1);

  if (!request) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual billing request not found' });
  }

  const result = request.organizationId
    ? await activateExistingOrganizationEntitlement({
        userId: request.userId,
        organizationId: request.organizationId,
        classrooms: request.classrooms,
        source: 'manual',
        productKind: request.kind,
        grantedBy: params.reviewedBy,
      })
    : await createOrganizationWithEntitlement({
        userId: request.userId,
        organizationName: request.organizationName,
        classrooms: request.classrooms,
        source: 'manual',
        productKind: request.kind,
        grantedBy: params.reviewedBy,
      });

  await db
    .update(schema.cpBillingManualRequests)
    .set({
      status: 'approved',
      organizationId: result.organizationId,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingManualRequests.id, request.id));

  return { organizationId: result.organizationId };
}

function verifyStripeSignature(payload: string, signatureHeader: string, secret: string): void {
  const pairs = new Map(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value] as const;
    })
  );
  const timestamp = pairs.get('t');
  const signature = pairs.get('v1');

  if (!timestamp || !signature) {
    throw new Error('Missing Stripe signature components');
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('Invalid Stripe signature');
  }
}

export async function processStripeWebhook(params: {
  rawBody: Buffer;
  signature: string | undefined;
}): Promise<void> {
  const secret = config.stripe.webhookSecret;
  if (!secret) {
    throw new Error('Stripe webhook secret is not configured');
  }
  if (!params.signature) {
    throw new Error('Missing Stripe signature');
  }

  const payload = params.rawBody.toString('utf8');
  verifyStripeSignature(payload, params.signature, secret);
  const event = JSON.parse(payload) as StripeWebhookEvent;

  const [existing] = await db
    .select({ id: schema.cpStripeWebhookEvents.id })
    .from(schema.cpStripeWebhookEvents)
    .where(eq(schema.cpStripeWebhookEvents.id, event.id))
    .limit(1);

  if (existing) return;

  if (event.type === 'checkout.session.completed') {
    await completeCheckoutSession(event.data?.object ?? {});
  }

  await db.insert(schema.cpStripeWebhookEvents).values({
    id: event.id,
    type: event.type,
    processedAt: new Date(),
  });
}

async function completeCheckoutSession(session: StripeSessionObject): Promise<void> {
  if (!session.id) {
    throw new Error('Stripe checkout session missing id');
  }

  const [intent] = await db
    .select()
    .from(schema.cpBillingCheckoutIntents)
    .where(eq(schema.cpBillingCheckoutIntents.stripeCheckoutSessionId, session.id))
    .limit(1);

  if (!intent) {
    throw new Error(`Billing checkout intent not found for session ${session.id}`);
  }

  if (intent.status === 'completed' && intent.organizationId) return;

  const result = intent.organizationId
    ? await activateExistingOrganizationEntitlement({
        userId: intent.userId,
        organizationId: intent.organizationId,
        classrooms: intent.classrooms,
        source: intent.kind === 'annual' ? 'stripe_subscription' : 'stripe_payment',
        productKind: intent.kind,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: session.subscription ?? null,
        expiresAt: intent.kind === 'pilot' ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
      })
    : await createOrganizationWithEntitlement({
        userId: intent.userId,
        organizationName: intent.organizationName,
        classrooms: intent.classrooms,
        source: intent.kind === 'annual' ? 'stripe_subscription' : 'stripe_payment',
        productKind: intent.kind,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: session.subscription ?? null,
        stripePaymentIntentId: session.payment_intent ?? null,
        expiresAt: intent.kind === 'pilot' ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
      });

  await db
    .update(schema.cpBillingCheckoutIntents)
    .set({
      status: 'completed',
      organizationId: result.organizationId,
      stripeCustomerId: session.customer ?? null,
      stripeSubscriptionId: session.subscription ?? null,
      stripePaymentIntentId: session.payment_intent ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingCheckoutIntents.id, intent.id));
}
