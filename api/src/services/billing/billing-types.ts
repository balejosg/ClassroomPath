import type { OrganizationEntitlement } from '../../db/schema.js';

export type CheckoutKind = 'annual' | 'pilot';
export type ManualRequestKind = 'public_campaign' | 'custom_quote';
export type BillingEntitlementStatus = 'active' | 'grace_period' | 'canceled' | 'expired';
export type BillingActorType = 'stripe' | 'platform_admin' | 'system' | 'user';

export type StripeRecord = Record<string, unknown>;

export const BILLING_GRACE_PERIOD_DAYS = 7;
export const PILOT_DURATION_DAYS = 90;
export const BILLING_AUDIT_TARGET_ENTITLEMENT = 'organization_entitlement';
export const BILLING_AUDIT_TARGET_REQUEST = 'billing_manual_request';
export const BILLING_AUDIT_TARGET_CHECKOUT = 'billing_checkout_intent';

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

export interface CheckoutRequest {
  userId: string;
  email: string;
  organizationName: string;
  classrooms: number;
  kind: CheckoutKind;
}

export interface ManualRequest {
  userId: string;
  organizationName: string;
  classrooms: number;
  kind: ManualRequestKind;
  note?: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data?: { object?: StripeRecord };
}

export interface EntitlementWriteParams {
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

export type BillingEntitlementRow = OrganizationEntitlement;
