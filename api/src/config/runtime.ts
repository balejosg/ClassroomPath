import { resolveDatabaseUrl } from '../lib/database-url.js';
import { resolveGatewayConfig } from '../lib/gateway-config.js';
import {
  assertBillingRuntimeConfigured,
  resolveBillingMode,
  resolvePlatformAdminEmails,
  resolveStripeConfig,
  type BillingMode,
  type EmailDeliveryMode,
  type StripeRuntimeConfig,
} from './billing.js';
import {
  DEFAULT_JWT_SECRET,
  isLocalDevelopment,
  isProduction,
  parseBooleanEnv,
  trimToNull,
  type RuntimeEnv,
} from './shared.js';

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
  pushNotificationsEnabled: boolean;
  resendApiKey: string | null;
  resendFromEmail: string | null;
  platformAdminEmails: string[];
  stripe: StripeRuntimeConfig;
}

export interface PushRuntimeConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  contact: string;
  required: boolean;
}

export function requireJwtSecret(env: RuntimeEnv = process.env): string {
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

export function resolvePublicUrl(env: RuntimeEnv = process.env): string {
  const publicUrl = trimToNull(env.PUBLIC_URL);
  if (publicUrl) {
    return normalizePublicUrl(publicUrl, env);
  }

  if (env.NODE_ENV === 'test' || isLocalDevelopment(env)) {
    return 'http://localhost:5173';
  }

  throw new Error('PUBLIC_URL must be set outside local development/test mode');
}

export function resolvePort(env: RuntimeEnv = process.env): number {
  return parseInt(env.CP_PORT ?? '3001', 10);
}

export function resolveOpenPathUrl(env: RuntimeEnv = process.env): string {
  return env.OPENPATH_API_URL ?? 'http://localhost:3000';
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

export function resolvePushRuntimeConfig(env: RuntimeEnv = process.env): PushRuntimeConfig {
  const publicKey = trimToNull(env.VAPID_PUBLIC_KEY) ?? '';
  const privateKey = trimToNull(env.VAPID_PRIVATE_KEY) ?? '';
  const publicUrl = trimToNull(env.PUBLIC_URL);
  const contact =
    trimToNull(env.VAPID_CONTACT) ??
    trimToNull(env.VAPID_SUBJECT) ??
    (publicUrl ? `mailto:admin@${new URL(normalizePublicUrl(publicUrl, env)).hostname}` : '');

  return {
    enabled: Boolean(publicKey && privateKey && contact),
    publicKey,
    privateKey,
    contact,
    required: parseBooleanEnv(env.CP_REQUIRE_PUSH_NOTIFICATIONS, false),
  };
}

export function assertPushRuntimeConfigured(env: RuntimeEnv = process.env): void {
  const push = resolvePushRuntimeConfig(env);
  const hasExplicitPushConfig = Boolean(
    trimToNull(env.VAPID_PUBLIC_KEY) ||
    trimToNull(env.VAPID_PRIVATE_KEY) ||
    trimToNull(env.VAPID_CONTACT) ||
    trimToNull(env.VAPID_SUBJECT)
  );

  if (!push.required && !hasExplicitPushConfig) {
    return;
  }

  const missing: string[] = [];
  if (!push.publicKey) {
    missing.push('VAPID_PUBLIC_KEY');
  }
  if (!push.privateKey) {
    missing.push('VAPID_PRIVATE_KEY');
  }
  if (!push.contact) {
    missing.push('VAPID_CONTACT');
  }

  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} must be set for push notifications`);
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
    pushNotificationsEnabled: resolvePushRuntimeConfig(env).enabled,
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
  assertPushRuntimeConfigured(env);

  if (!gatewayConfig.corsOrigins.includes(gatewayConfig.publicOrigin)) {
    throw new Error('CORS_ORIGINS must include the PUBLIC_URL origin');
  }
}
