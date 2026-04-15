import { trimToNull, type RuntimeEnv } from './shared.js';

export type EmailDeliveryMode = 'mock' | 'resend' | 'disabled';
export type BillingMode = 'stripe' | 'manual_only';

export interface StripeRuntimeConfig {
  secretKey: string | null;
  webhookSecret: string | null;
  priceIds: {
    annual: {
      '1_10': string | null;
      '11_25': string | null;
      '26_50': string | null;
      '51_100': string | null;
    };
    onboarding: {
      '1_25': string | null;
      '26_100': string | null;
    };
    pilot: string | null;
  };
}

export interface BillingRuntimeConfig {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
  billingMode: BillingMode;
  platformAdminEmails: string[];
  stripe: StripeRuntimeConfig;
}

export function resolvePlatformAdminEmails(env: RuntimeEnv = process.env): string[] {
  return (env.CP_PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function resolveBillingMode(env: RuntimeEnv = process.env): BillingMode {
  const mode = trimToNull(env.CP_BILLING_MODE);
  if (!mode) {
    return 'manual_only';
  }

  if (mode === 'stripe' || mode === 'manual_only') {
    return mode;
  }

  throw new Error('CP_BILLING_MODE must be one of: stripe, manual_only');
}

export function resolveStripeConfig(env: RuntimeEnv = process.env): StripeRuntimeConfig {
  return {
    secretKey: trimToNull(env.STRIPE_SECRET_KEY),
    webhookSecret: trimToNull(env.STRIPE_WEBHOOK_SECRET),
    priceIds: {
      annual: {
        '1_10': trimToNull(env.STRIPE_ANNUAL_PRICE_1_10),
        '11_25': trimToNull(env.STRIPE_ANNUAL_PRICE_11_25),
        '26_50': trimToNull(env.STRIPE_ANNUAL_PRICE_26_50),
        '51_100': trimToNull(env.STRIPE_ANNUAL_PRICE_51_100),
      },
      onboarding: {
        '1_25': trimToNull(env.STRIPE_ONBOARDING_PRICE_1_25),
        '26_100': trimToNull(env.STRIPE_ONBOARDING_PRICE_26_100),
      },
      pilot: trimToNull(env.STRIPE_PILOT_PRICE),
    },
  };
}

export function assertBillingRuntimeConfigured(runtimeConfig: BillingRuntimeConfig): void {
  if (runtimeConfig.allowSelfServiceOrgs) {
    return;
  }

  if (runtimeConfig.platformAdminEmails.length === 0) {
    throw new Error(
      'CP_PLATFORM_ADMIN_EMAILS must be set when billing-gated onboarding is enabled'
    );
  }

  if (runtimeConfig.billingMode === 'manual_only') {
    return;
  }

  if (!runtimeConfig.stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY must be set when billing-gated onboarding is enabled');
  }

  if (!runtimeConfig.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be set when billing-gated onboarding is enabled');
  }

  const requiredPrices = [
    runtimeConfig.stripe.priceIds.annual['1_10'],
    runtimeConfig.stripe.priceIds.annual['11_25'],
    runtimeConfig.stripe.priceIds.annual['26_50'],
    runtimeConfig.stripe.priceIds.annual['51_100'],
    runtimeConfig.stripe.priceIds.onboarding['1_25'],
    runtimeConfig.stripe.priceIds.onboarding['26_100'],
    runtimeConfig.stripe.priceIds.pilot,
  ];

  if (requiredPrices.some((priceId) => !priceId)) {
    throw new Error('All STRIPE_* price ids must be set when billing-gated onboarding is enabled');
  }
}
