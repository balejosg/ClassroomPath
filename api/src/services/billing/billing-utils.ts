import { TRPCError } from '@trpc/server';

import { config } from '../../config.js';

export {
  addDays,
  effectiveEntitlementStatus,
  isActiveEntitlement,
  toBillingStatusDto,
  toIso,
} from './billing-entitlement-status.js';
export {
  asStripeRecord,
  getBoolean,
  getNumber,
  getString,
  getUnixDate,
  readInvoiceCurrentPeriodEnd,
} from './billing-stripe-record.js';
export {
  assertStripeBillingEnabled,
  createStripeCheckoutSession,
  formEncodeCheckout,
  getLineItems,
  isStripeBillingEnabled,
  requireStripeSecret,
} from './billing-stripe-checkout.service.js';

export function assertClassroomCount(classrooms: number): void {
  if (!Number.isInteger(classrooms) || classrooms < 1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom count must be positive' });
  }
}

export function isPlatformAdminEmail(email: string): boolean {
  return config.platformAdminEmails.includes(email.trim().toLowerCase());
}

export function assertPlatformAdmin(user: { email: string }): void {
  if (!isPlatformAdminEmail(user.email)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
  }
}
