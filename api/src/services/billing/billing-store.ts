import type { OrganizationEntitlement } from '../../db/schema.js';
import type { BillingEntitlementSummaryDto, ManualBillingRequestDto } from './billing-types.js';
import { effectiveEntitlementStatus, toIso } from './billing-utils.js';

export { getBillingAuditTrail, recordBillingAuditEvent } from './billing-audit-store.js';
export {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  findEntitlementByStripeReference,
  getExistingBillingOrganization,
  updateEntitlementLifecycleFromStripe,
  upsertOrganizationEntitlement,
} from './billing-entitlement-store.js';

export function toManualBillingRequestDto(request: {
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
  reviewedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}): ManualBillingRequestDto {
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

export function toEntitlementSummaryDto(row: {
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
    } satisfies OrganizationEntitlement) ?? 'expired';

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
