/**
 * Runtime environment policy resolver for the ClassroomPath API.
 *
 * Owns the single authoritative pass over process.env at startup: reads the
 * policy catalog JSON (config/runtime-environment-policy.catalog.json), then
 * exposes typed resolve* helpers that translate raw env vars into structured
 * policy objects (RuntimeEnvironmentPolicy, PushRuntimePolicy, etc.).
 *
 * Consumed by api/src/config.ts (the top-level config singleton) and by the
 * startup assertion in api/src/server.ts via assertRuntimeEnvironmentPolicyConfigured.
 *
 * Non-obvious constraint: billing validation is asymmetric -- when
 * CP_ALLOW_SELF_SERVICE_ORGS is true the stripe/admin-email checks are
 * bypassed entirely, so tests that set that flag must NOT also assert that
 * Stripe vars are required.
 */
import { readFileSync } from 'node:fs';

import { parseBooleanEnv, trimToNull, type RuntimeEnv } from './shared.js';

export type { RuntimeEnv } from './shared.js';

export type BillingMode = 'stripe' | 'manual_only';
export type EmailDeliveryMode = 'mock' | 'resend' | 'disabled';
export type EmailPreflightMode = 'required' | 'skip';

interface RuntimeEnvironmentPolicyCatalog {
  billingBaseRequiredEnvNames: string[];
  stripeRequiredEnvNames: string[];
  optionalBillingEnvNames: string[];
  pushEnvNames: string[];
  stagingEmailPreflightModes: string[];
}

function loadRuntimeEnvironmentPolicyCatalog(): RuntimeEnvironmentPolicyCatalog {
  const catalogUrl = new URL(
    '../../../config/runtime-environment-policy.catalog.json',
    import.meta.url
  );
  return JSON.parse(readFileSync(catalogUrl, 'utf8')) as RuntimeEnvironmentPolicyCatalog;
}

const runtimeEnvironmentPolicyCatalog = loadRuntimeEnvironmentPolicyCatalog();

export const BILLING_BASE_REQUIRED_ENV_NAMES =
  runtimeEnvironmentPolicyCatalog.billingBaseRequiredEnvNames;

export const STRIPE_REQUIRED_ENV_NAMES = runtimeEnvironmentPolicyCatalog.stripeRequiredEnvNames;

export const OPTIONAL_BILLING_ENV_NAMES = runtimeEnvironmentPolicyCatalog.optionalBillingEnvNames;

export const PUSH_ENV_NAMES = runtimeEnvironmentPolicyCatalog.pushEnvNames;

export const STAGING_EMAIL_PREFLIGHT_MODES =
  runtimeEnvironmentPolicyCatalog.stagingEmailPreflightModes;

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

export interface PushRuntimePolicy {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  contact: string;
  required: boolean;
}

export interface EmailRuntimePolicy {
  deliveryMode: EmailDeliveryMode;
  mockDelivery: boolean;
  preflightMode: EmailPreflightMode;
  resendApiKey: string | null;
  resendFromEmail: string | null;
}

export interface RuntimeEnvironmentPolicy {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
  billingMode: BillingMode;
  clientCanaryAdminToken: string | null;
  email: EmailRuntimePolicy;
  platformAdminEmails: string[];
  push: PushRuntimePolicy;
  stripe: StripeRuntimeConfig;
}

export function normalizeRuntimePublicUrl(value: string, env: RuntimeEnv): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must use http:// or https://');
  }

  if (
    env.NODE_ENV === 'production' &&
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
  ) {
    throw new Error('PUBLIC_URL must not point to localhost in production');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return pathname ? `${url.origin}${pathname}` : url.origin;
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

export function resolveClientCanaryAdminToken(env: RuntimeEnv = process.env): string | null {
  return trimToNull(env.CP_CLIENT_CANARY_ADMIN_TOKEN);
}

export function resolveResendApiKey(env: RuntimeEnv = process.env): string | null {
  return trimToNull(env.RESEND_API_KEY);
}

export function resolveResendFromEmail(env: RuntimeEnv = process.env): string | null {
  return trimToNull(env.RESEND_FROM_EMAIL);
}

export function resolveMockEmailDelivery(env: RuntimeEnv = process.env): boolean {
  return parseBooleanEnv(env.CP_FAKE_EMAIL_DELIVERY, false);
}

export function resolveEmailDeliveryMode(env: RuntimeEnv = process.env): EmailDeliveryMode {
  if (resolveMockEmailDelivery(env)) {
    return 'mock';
  }

  return trimToNull(env.RESEND_API_KEY) && trimToNull(env.RESEND_FROM_EMAIL)
    ? 'resend'
    : 'disabled';
}

export function resolveEmailPreflightMode(env: RuntimeEnv = process.env): EmailPreflightMode {
  const mode = trimToNull(env.CP_EMAIL_PREFLIGHT_MODE);
  if (!mode) {
    return 'required';
  }

  if (mode === 'required' || mode === 'skip') {
    return mode;
  }

  throw new Error('CP_EMAIL_PREFLIGHT_MODE must be one of: required, skip');
}

export function resolveEmailRuntimePolicy(env: RuntimeEnv = process.env): EmailRuntimePolicy {
  return {
    deliveryMode: resolveEmailDeliveryMode(env),
    mockDelivery: resolveMockEmailDelivery(env),
    preflightMode: resolveEmailPreflightMode(env),
    resendApiKey: trimToNull(env.RESEND_API_KEY),
    resendFromEmail: trimToNull(env.RESEND_FROM_EMAIL),
  };
}

export function resolvePushRuntimePolicy(env: RuntimeEnv = process.env): PushRuntimePolicy {
  const publicKey = trimToNull(env.VAPID_PUBLIC_KEY) ?? '';
  const privateKey = trimToNull(env.VAPID_PRIVATE_KEY) ?? '';
  const publicUrl = trimToNull(env.PUBLIC_URL);
  const contact =
    trimToNull(env.VAPID_CONTACT) ??
    trimToNull(env.VAPID_SUBJECT) ??
    (publicUrl
      ? `mailto:admin@${new URL(normalizeRuntimePublicUrl(publicUrl, env)).hostname}`
      : '');

  return {
    enabled: Boolean(publicKey && privateKey && contact),
    publicKey,
    privateKey,
    contact,
    required: parseBooleanEnv(env.CP_REQUIRE_PUSH_NOTIFICATIONS, false),
  };
}

export function resolveRuntimeEnvironmentPolicy(
  env: RuntimeEnv = process.env
): RuntimeEnvironmentPolicy {
  return {
    allowOrgDirectory: parseBooleanEnv(env.CP_ALLOW_ORG_DIRECTORY, false),
    allowSelfServiceOrgs: parseBooleanEnv(env.CP_ALLOW_SELF_SERVICE_ORGS, false),
    billingMode: resolveBillingMode(env),
    clientCanaryAdminToken: resolveClientCanaryAdminToken(env),
    email: resolveEmailRuntimePolicy(env),
    platformAdminEmails: resolvePlatformAdminEmails(env),
    push: resolvePushRuntimePolicy(env),
    stripe: resolveStripeConfig(env),
  };
}

export function assertBillingPolicyConfigured(
  policy: Pick<
    RuntimeEnvironmentPolicy,
    'allowSelfServiceOrgs' | 'billingMode' | 'platformAdminEmails' | 'stripe'
  >
): void {
  if (policy.allowSelfServiceOrgs) {
    return;
  }

  if (policy.platformAdminEmails.length === 0) {
    throw new Error(
      'CP_PLATFORM_ADMIN_EMAILS must be set when billing-gated onboarding is enabled'
    );
  }

  if (policy.billingMode === 'manual_only') {
    return;
  }

  if (!policy.stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY must be set when billing-gated onboarding is enabled');
  }

  if (!policy.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be set when billing-gated onboarding is enabled');
  }

  const requiredPrices = [
    policy.stripe.priceIds.annual['1_10'],
    policy.stripe.priceIds.annual['11_25'],
    policy.stripe.priceIds.annual['26_50'],
    policy.stripe.priceIds.annual['51_100'],
    policy.stripe.priceIds.onboarding['1_25'],
    policy.stripe.priceIds.onboarding['26_100'],
    policy.stripe.priceIds.pilot,
  ];

  if (requiredPrices.some((priceId) => !priceId)) {
    throw new Error('All STRIPE_* price ids must be set when billing-gated onboarding is enabled');
  }
}

export function assertPushPolicyConfigured(
  policy: PushRuntimePolicy,
  env: RuntimeEnv = process.env
): void {
  const hasExplicitPushConfig = Boolean(
    trimToNull(env.VAPID_PUBLIC_KEY) ||
    trimToNull(env.VAPID_PRIVATE_KEY) ||
    trimToNull(env.VAPID_CONTACT) ||
    trimToNull(env.VAPID_SUBJECT)
  );

  if (!policy.required && !hasExplicitPushConfig) {
    return;
  }

  const missing: string[] = [];
  if (!policy.publicKey) {
    missing.push('VAPID_PUBLIC_KEY');
  }
  if (!policy.privateKey) {
    missing.push('VAPID_PRIVATE_KEY');
  }
  if (!policy.contact) {
    missing.push('VAPID_CONTACT');
  }

  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} must be set for push notifications`);
  }
}

export function assertRuntimeEnvironmentPolicyConfigured(env: RuntimeEnv = process.env): void {
  const policy = resolveRuntimeEnvironmentPolicy(env);
  assertBillingPolicyConfigured(policy);
  assertPushPolicyConfigured(policy.push, env);
}
