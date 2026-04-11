import { resolveDatabaseUrl } from './lib/database-url.js';

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

export interface RuntimeConfig {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
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
    platformAdminEmails: resolvePlatformAdminEmails(env),
    stripe: resolveStripeConfig(env),
  };
}

export function assertRuntimeSecretsConfigured(env: RuntimeEnv = process.env): void {
  const runtimeConfig = resolveRuntimeConfig(env);
  void runtimeConfig.jwtSecret;
  void runtimeConfig.publicUrl;
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
  get platformAdminEmails() {
    return resolvePlatformAdminEmails(process.env);
  },
  get stripe() {
    return resolveStripeConfig(process.env);
  },
};
