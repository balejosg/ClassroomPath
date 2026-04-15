import { TRPCError } from '@trpc/server';

import { config } from '../../config.js';
import type { CheckoutKind } from './billing-types.js';

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

export function requireStripePrice(price: string | null, label: string): string {
  if (!price) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Stripe price is not configured: ${label}`,
    });
  }

  return price;
}

export function getLineItems(input: { kind: CheckoutKind; classrooms: number }): Array<{
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
