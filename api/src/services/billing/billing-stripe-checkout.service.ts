import { TRPCError } from '@trpc/server';

import { config } from '../../config.js';
export { getLineItems, requireStripePrice } from './billing-stripe-pricing.service.js';
export {
  createStripeCheckoutSession,
  formEncodeCheckout,
  requireStripeSecret,
} from './billing-stripe-session.service.js';

export function isStripeBillingEnabled(): boolean {
  return config.billingMode === 'stripe';
}

export function assertStripeBillingEnabled(): void {
  if (isStripeBillingEnabled()) {
    return;
  }

  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'Online checkout is not available in this environment yet.',
  });
}
