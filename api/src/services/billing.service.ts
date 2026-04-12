import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import type { OrganizationEntitlement } from '../db/schema.js';

type CheckoutKind = 'annual' | 'pilot';
type ManualRequestKind = 'public_campaign' | 'custom_quote';
type BillingEntitlementStatus = 'active' | 'grace_period' | 'canceled' | 'expired';
type BillingActorType = 'stripe' | 'platform_admin' | 'system' | 'user';

type StripeRecord = Record<string, unknown>;

const BILLING_GRACE_PERIOD_DAYS = 7;
const PILOT_DURATION_DAYS = 90;
const BILLING_AUDIT_TARGET_ENTITLEMENT = 'organization_entitlement';
const BILLING_AUDIT_TARGET_REQUEST = 'billing_manual_request';
const BILLING_AUDIT_TARGET_CHECKOUT = 'billing_checkout_intent';

export interface BillingStatusDto {
  hasActiveEntitlement: boolean;
  source: string | null;
  status: BillingEntitlementStatus | null;
  productKind: string | null;
  classroomLimit: number | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  expiresAt: string | null;
}

export interface ManualBillingRequestDto {
  id: string;
  userId: string;
  organizationId: string | null;
  organizationName: string;
  kind: string;
  classrooms: number;
  status: string;
  note: string | null;
  resolutionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BillingEntitlementSummaryDto {
  organizationId: string;
  organizationName: string;
  source: string;
  status: BillingEntitlementStatus;
  productKind: string;
  classroomLimit: number;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface BillingAuditTrailEntryDto {
  id: string;
  organizationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
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

interface StripeWebhookEvent {
  id: string;
  type: string;
  data?: { object?: StripeRecord };
}

interface EntitlementWriteParams {
  organizationId: string;
  source: 'stripe_subscription' | 'stripe_payment' | 'manual';
  status: BillingEntitlementStatus;
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

function isStripeBillingEnabled(): boolean {
  return config.billingMode === 'stripe';
}

function assertStripeBillingEnabled(): void {
  if (isStripeBillingEnabled()) {
    return;
  }

  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'Online checkout is not available in this environment yet.',
  });
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

function asStripeRecord(value: unknown): StripeRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StripeRecord) : {};
}

function getString(record: StripeRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getBoolean(record: StripeRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function getNumber(record: StripeRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getUnixDate(record: StripeRecord, key: string): Date | null {
  const value = getNumber(record, key);
  return value ? new Date(value * 1000) : null;
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function readInvoiceCurrentPeriodEnd(invoice: StripeRecord): Date | null {
  const directPeriodEnd = getUnixDate(invoice, 'period_end');
  if (directPeriodEnd) return directPeriodEnd;

  const lines = invoice.lines;
  if (!lines || typeof lines !== 'object') return null;
  const linesRecord = asStripeRecord(lines);
  const data = linesRecord.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const firstLine = asStripeRecord(data[0]);
  const period = asStripeRecord(firstLine.period);
  return getUnixDate(period, 'end');
}

function effectiveEntitlementStatus(
  entitlement: OrganizationEntitlement | null
): BillingEntitlementStatus | null {
  if (!entitlement) return null;

  const now = Date.now();
  if (entitlement.status === 'expired' || entitlement.status === 'canceled') {
    return entitlement.status;
  }

  if (entitlement.cancelAtPeriodEnd && entitlement.currentPeriodEnd) {
    if (entitlement.currentPeriodEnd.getTime() <= now) {
      return 'canceled';
    }
  }

  if (entitlement.status === 'grace_period' && entitlement.graceEndsAt) {
    if (entitlement.graceEndsAt.getTime() <= now) {
      return 'expired';
    }
  }

  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= now) {
    return 'expired';
  }

  return entitlement.status as BillingEntitlementStatus;
}

function isActiveEntitlement(entitlement: OrganizationEntitlement | null): boolean {
  const status = effectiveEntitlementStatus(entitlement);
  return status === 'active' || status === 'grace_period';
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
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

async function recordBillingAuditEvent(params: {
  organizationId?: string | null;
  actorType: BillingActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.cpBillingAuditEvents).values({
    id: generateId('bill_audit'),
    organizationId: params.organizationId ?? null,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata ?? {},
  });
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

async function upsertOrganizationEntitlement(params: EntitlementWriteParams): Promise<void> {
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

async function activateExistingOrganizationEntitlement(params: {
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

async function createOrganizationWithEntitlement(params: {
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

export function isPlatformAdminEmail(email: string): boolean {
  return config.platformAdminEmails.includes(email.trim().toLowerCase());
}

export function assertPlatformAdmin(user: { email: string }): void {
  if (!isPlatformAdminEmail(user.email)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
  }
}

export function toBillingStatusDto(entitlement: OrganizationEntitlement | null): BillingStatusDto {
  return {
    hasActiveEntitlement: isActiveEntitlement(entitlement),
    source: entitlement?.source ?? null,
    status: effectiveEntitlementStatus(entitlement),
    productKind: entitlement?.productKind ?? null,
    classroomLimit: entitlement?.classroomLimit ?? null,
    currentPeriodEnd: toIso(entitlement?.currentPeriodEnd),
    graceEndsAt: toIso(entitlement?.graceEndsAt),
    cancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd ?? false,
    expiresAt: toIso(entitlement?.expiresAt),
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

  await recordBillingAuditEvent({
    organizationId: existingOrganization?.id ?? null,
    actorType: 'user',
    actorId: input.userId,
    action: 'manual-request.created',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: requestId,
    metadata: {
      kind: input.kind,
      classrooms: input.classrooms,
      note: input.note ?? null,
    },
  });

  return { requestId };
}

function toManualBillingRequestDto(
  request: typeof schema.cpBillingManualRequests.$inferSelect
): ManualBillingRequestDto {
  return {
    id: request.id,
    userId: request.userId,
    organizationId: request.organizationId ?? null,
    organizationName: request.organizationName,
    kind: request.kind,
    classrooms: request.classrooms,
    status: request.status,
    note: request.note ?? null,
    resolutionNote: request.resolutionNote ?? null,
    reviewedBy: request.reviewedBy ?? null,
    reviewedAt: toIso(request.reviewedAt),
    createdAt: toIso(request.createdAt),
    updatedAt: toIso(request.updatedAt),
  };
}

export async function listManualBillingRequests(): Promise<ManualBillingRequestDto[]> {
  const rows = await db
    .select()
    .from(schema.cpBillingManualRequests)
    .orderBy(desc(schema.cpBillingManualRequests.createdAt));

  return rows.map(toManualBillingRequestDto);
}

export async function approveManualBillingRequest(params: {
  requestId: string;
  reviewedBy: string;
  resolutionNote: string;
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

  if (!params.resolutionNote.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Resolution note is required' });
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
      resolutionNote: params.resolutionNote.trim(),
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingManualRequests.id, request.id));

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'manual-request.approved',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: request.id,
    metadata: {
      resolutionNote: params.resolutionNote.trim(),
      classrooms: request.classrooms,
      kind: request.kind,
    },
  });

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'entitlement.activated',
    targetType: BILLING_AUDIT_TARGET_ENTITLEMENT,
    targetId: result.organizationId,
    metadata: {
      source: 'manual',
      productKind: request.kind,
      classrooms: request.classrooms,
      resolutionNote: params.resolutionNote.trim(),
    },
  });

  return { organizationId: result.organizationId };
}

export async function rejectManualBillingRequest(params: {
  requestId: string;
  reviewedBy: string;
  resolutionNote: string;
}): Promise<{ requestId: string }> {
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

  if (!params.resolutionNote.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Resolution note is required' });
  }

  await db
    .update(schema.cpBillingManualRequests)
    .set({
      status: 'rejected',
      resolutionNote: params.resolutionNote.trim(),
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingManualRequests.id, request.id));

  await recordBillingAuditEvent({
    organizationId: request.organizationId ?? null,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'manual-request.rejected',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: request.id,
    metadata: {
      resolutionNote: params.resolutionNote.trim(),
      classrooms: request.classrooms,
      kind: request.kind,
    },
  });

  return { requestId: request.id };
}

function toEntitlementSummaryDto(row: {
  organizationId: string;
  organizationName: string;
  source: string;
  status: string;
  productKind: string;
  classroomLimit: number;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  expiresAt: Date | null;
  updatedAt: Date | null;
}): BillingEntitlementSummaryDto {
  const effectiveStatus =
    effectiveEntitlementStatus({
      organizationId: row.organizationId,
      source: row.source,
      status: row.status,
      productKind: row.productKind,
      classroomLimit: row.classroomLimit,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: row.currentPeriodEnd,
      graceEndsAt: row.graceEndsAt,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      lastStripeEventType: null,
      lastStripeEventId: null,
      expiresAt: row.expiresAt,
      grantedBy: null,
      createdAt: row.updatedAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
    }) ?? 'expired';

  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    source: row.source,
    status: effectiveStatus,
    productKind: row.productKind,
    classroomLimit: row.classroomLimit,
    currentPeriodEnd: toIso(row.currentPeriodEnd),
    graceEndsAt: toIso(row.graceEndsAt),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    expiresAt: toIso(row.expiresAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listOrganizationEntitlements(): Promise<BillingEntitlementSummaryDto[]> {
  const rows = await db
    .select({
      organizationId: schema.cpOrganizationEntitlements.organizationId,
      organizationName: schema.cpOrganizations.name,
      source: schema.cpOrganizationEntitlements.source,
      status: schema.cpOrganizationEntitlements.status,
      productKind: schema.cpOrganizationEntitlements.productKind,
      classroomLimit: schema.cpOrganizationEntitlements.classroomLimit,
      currentPeriodEnd: schema.cpOrganizationEntitlements.currentPeriodEnd,
      graceEndsAt: schema.cpOrganizationEntitlements.graceEndsAt,
      cancelAtPeriodEnd: schema.cpOrganizationEntitlements.cancelAtPeriodEnd,
      expiresAt: schema.cpOrganizationEntitlements.expiresAt,
      updatedAt: schema.cpOrganizationEntitlements.updatedAt,
    })
    .from(schema.cpOrganizationEntitlements)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpOrganizationEntitlements.organizationId, schema.cpOrganizations.id)
    )
    .orderBy(desc(schema.cpOrganizationEntitlements.updatedAt));

  return rows.map(toEntitlementSummaryDto);
}

export async function getBillingAuditTrail(
  filters: {
    organizationId?: string;
    requestId?: string;
  } = {}
): Promise<BillingAuditTrailEntryDto[]> {
  let rows: Array<typeof schema.cpBillingAuditEvents.$inferSelect>;

  if (filters.organizationId && filters.requestId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(
        and(
          eq(schema.cpBillingAuditEvents.organizationId, filters.organizationId),
          eq(schema.cpBillingAuditEvents.targetType, BILLING_AUDIT_TARGET_REQUEST),
          eq(schema.cpBillingAuditEvents.targetId, filters.requestId)
        )
      )
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else if (filters.organizationId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(eq(schema.cpBillingAuditEvents.organizationId, filters.organizationId))
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else if (filters.requestId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(
        and(
          eq(schema.cpBillingAuditEvents.targetType, BILLING_AUDIT_TARGET_REQUEST),
          eq(schema.cpBillingAuditEvents.targetId, filters.requestId)
        )
      )
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  }

  return rows.slice(0, 100).map((row) => ({
    id: row.id,
    organizationId: row.organizationId ?? null,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: toIso(row.createdAt),
  }));
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

async function findEntitlementByStripeReference(params: {
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

async function updateEntitlementLifecycleFromStripe(params: {
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
    params.nextStatus === 'grace_period'
      ? (params.graceEndsAt ?? addDays(BILLING_GRACE_PERIOD_DAYS))
      : null;
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
    targetType: BILLING_AUDIT_TARGET_ENTITLEMENT,
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

async function handleInvoiceWebhook(event: StripeWebhookEvent): Promise<void> {
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

async function handleSubscriptionWebhook(event: StripeWebhookEvent): Promise<void> {
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

export async function processStripeWebhook(params: {
  rawBody: Buffer;
  signature: string | undefined;
}): Promise<void> {
  if (!isStripeBillingEnabled()) {
    return;
  }

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
    await completeCheckoutSession(event);
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    await handleInvoiceWebhook(event);
  } else if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleSubscriptionWebhook(event);
  }

  await db.insert(schema.cpStripeWebhookEvents).values({
    id: event.id,
    type: event.type,
    processedAt: new Date(),
  });
}

async function completeCheckoutSession(event: StripeWebhookEvent): Promise<void> {
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
