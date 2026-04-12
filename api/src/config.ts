import { resolveDatabaseUrl } from './lib/database-url.js';
import { resolveGatewayConfig } from './lib/gateway-config.js';

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

const trimToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

type RuntimeEnv = Record<string, string | undefined>;

export type EmailDeliveryMode = 'mock' | 'resend' | 'disabled';
export type BillingMode = 'stripe' | 'manual_only';

export interface RuntimeConfig {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
  billingMode: BillingMode;
  databaseUrl: string;
  emailDeliveryMode: EmailDeliveryMode;
  jwtSecret: string;
  mockEmailDelivery: boolean;
  openpathUrl: string;
  port: number;
  publicUrl: string;
  resendApiKey: string | null;
  resendFromEmail: string | null;
  platformAdminEmails: string[];
  stripe: StripeRuntimeConfig;
}

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

function isProduction(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

function isLocalDevelopment(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === undefined;
}

export const DEFAULT_JWT_SECRET = 'dev-secret-key-change-me-in-production';

function requireJwtSecret(env: RuntimeEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();

  if (env.NODE_ENV === 'test') {
    return secret && secret.length > 0 ? secret : DEFAULT_JWT_SECRET;
  }

  if (!secret) {
    throw new Error('JWT_SECRET must be set outside test mode');
  }

  if (secret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the default development value outside test mode');
  }

  return secret;
}

function normalizePublicUrl(value: string, env: RuntimeEnv): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must use http:// or https://');
  }

  if (isProduction(env) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
    throw new Error('PUBLIC_URL must not point to localhost in production');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return pathname ? `${url.origin}${pathname}` : url.origin;
}

function resolvePublicUrl(env: RuntimeEnv = process.env): string {
  const publicUrl = trimToNull(env.PUBLIC_URL);
  if (publicUrl) {
    return normalizePublicUrl(publicUrl, env);
  }

  if (env.NODE_ENV === 'test' || isLocalDevelopment(env)) {
    return 'http://localhost:5173';
  }

  throw new Error('PUBLIC_URL must be set outside local development/test mode');
}

function resolvePort(env: RuntimeEnv = process.env): number {
  return parseInt(env.CP_PORT ?? '3001', 10);
}

function resolveOpenPathUrl(env: RuntimeEnv = process.env): string {
  return env.OPENPATH_API_URL ?? 'http://localhost:3000';
}

function resolveMockEmailDelivery(env: RuntimeEnv = process.env): boolean {
  return parseBooleanEnv(env.CP_FAKE_EMAIL_DELIVERY, false);
}

function resolveEmailDeliveryMode(env: RuntimeEnv = process.env): EmailDeliveryMode {
  if (resolveMockEmailDelivery(env)) {
    return 'mock';
  }

  return trimToNull(env.RESEND_API_KEY) && trimToNull(env.RESEND_FROM_EMAIL)
    ? 'resend'
    : 'disabled';
}

function resolvePlatformAdminEmails(env: RuntimeEnv = process.env): string[] {
  return (env.CP_PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function resolveBillingMode(env: RuntimeEnv = process.env): BillingMode {
  const mode = trimToNull(env.CP_BILLING_MODE);
  if (!mode) {
    return 'manual_only';
  }

  if (mode === 'stripe' || mode === 'manual_only') {
    return mode;
  }

  throw new Error('CP_BILLING_MODE must be one of: stripe, manual_only');
}

function resolveStripeConfig(env: RuntimeEnv = process.env): StripeRuntimeConfig {
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

function assertBillingRuntimeConfigured(runtimeConfig: RuntimeConfig): void {
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

export function resolveRuntimeConfig(env: RuntimeEnv = process.env): RuntimeConfig {
  const resendApiKey = trimToNull(env.RESEND_API_KEY);
  const resendFromEmail = trimToNull(env.RESEND_FROM_EMAIL);

  return {
    port: resolvePort(env),
    openpathUrl: resolveOpenPathUrl(env),
    databaseUrl: resolveDatabaseUrl(env),
    publicUrl: resolvePublicUrl(env),
    jwtSecret: requireJwtSecret(env),
    resendApiKey,
    resendFromEmail,
    mockEmailDelivery: resolveMockEmailDelivery(env),
    emailDeliveryMode: resolveEmailDeliveryMode(env),
    allowSelfServiceOrgs: parseBooleanEnv(env.CP_ALLOW_SELF_SERVICE_ORGS, false),
    allowOrgDirectory: parseBooleanEnv(env.CP_ALLOW_ORG_DIRECTORY, false),
    billingMode: resolveBillingMode(env),
    platformAdminEmails: resolvePlatformAdminEmails(env),
    stripe: resolveStripeConfig(env),
  };
}

export function assertRuntimeSecretsConfigured(env: RuntimeEnv = process.env): void {
  const runtimeConfig = resolveRuntimeConfig(env);
  const gatewayConfig = resolveGatewayConfig(undefined, env);
  void runtimeConfig.jwtSecret;
  void runtimeConfig.publicUrl;
  void gatewayConfig.corsOrigins;

  assertBillingRuntimeConfigured(runtimeConfig);

  if (!gatewayConfig.corsOrigins.includes(gatewayConfig.publicOrigin)) {
    throw new Error('CORS_ORIGINS must include the PUBLIC_URL origin');
  }
}

export const config = {
  get port() {
    return resolvePort(process.env);
  },
  get openpathUrl() {
    return resolveOpenPathUrl(process.env);
  },
  get databaseUrl() {
    return resolveDatabaseUrl(process.env);
  },
  get publicUrl() {
    return resolvePublicUrl(process.env);
  },
  get jwtSecret() {
    return requireJwtSecret(process.env);
  },
  get resendApiKey() {
    return trimToNull(process.env.RESEND_API_KEY);
  },
  get resendFromEmail() {
    return trimToNull(process.env.RESEND_FROM_EMAIL);
  },
  get mockEmailDelivery() {
    return resolveMockEmailDelivery(process.env);
  },
  get emailDeliveryMode(): EmailDeliveryMode {
    return resolveEmailDeliveryMode(process.env);
  },
  get allowSelfServiceOrgs() {
    return parseBooleanEnv(process.env.CP_ALLOW_SELF_SERVICE_ORGS, false);
  },
  get allowOrgDirectory() {
    return parseBooleanEnv(process.env.CP_ALLOW_ORG_DIRECTORY, false);
  },
  get billingMode(): BillingMode {
    return resolveBillingMode(process.env);
  },
  get platformAdminEmails() {
    return resolvePlatformAdminEmails(process.env);
  },
  get stripe() {
    return resolveStripeConfig(process.env);
  },
};
