import type { OrganizationEntitlement } from '../../db/schema.js';
import type { BillingEntitlementStatus, BillingStatusDto } from './billing-types.js';

export function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function effectiveEntitlementStatus(
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

export function isActiveEntitlement(entitlement: OrganizationEntitlement | null): boolean {
  const status = effectiveEntitlementStatus(entitlement);
  return status === 'active' || status === 'grace_period';
}

export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
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
