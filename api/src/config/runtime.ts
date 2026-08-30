import { resolveDatabaseUrl } from '../lib/database-url.js';
import { resolveGatewayConfig } from '../lib/gateway-config.js';
import { type BillingMode, type EmailDeliveryMode, type StripeRuntimeConfig } from './billing.js';
import {
  assertPushPolicyConfigured,
  assertRuntimeEnvironmentPolicyConfigured,
  normalizeRuntimePublicUrl,
  resolveEmailDeliveryMode,
  resolveMockEmailDelivery,
  resolvePushRuntimePolicy,
  resolveRuntimeEnvironmentPolicy,
} from './runtime-environment-policy.js';
import { DEFAULT_JWT_SECRET, isLocalDevelopment, type RuntimeEnv } from './shared.js';

export { resolveEmailDeliveryMode, resolveMockEmailDelivery };

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
  return normalizeRuntimePublicUrl(value, env);
}

export function resolvePublicUrl(env: RuntimeEnv = process.env): string {
  // Keep the raw configured value for the strict origin parser. Trimming here
  // would turn malformed configuration into a different, valid origin.
  const publicUrl = env.PUBLIC_URL;
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

export function resolvePushRuntimeConfig(env: RuntimeEnv = process.env): PushRuntimeConfig {
  return resolvePushRuntimePolicy(env);
}

export function assertPushRuntimeConfigured(env: RuntimeEnv = process.env): void {
  assertPushPolicyConfigured(resolvePushRuntimeConfig(env), env);
}

export function resolveRuntimeConfig(env: RuntimeEnv = process.env): RuntimeConfig {
  const policy = resolveRuntimeEnvironmentPolicy(env);

  return {
    port: resolvePort(env),
    openpathUrl: resolveOpenPathUrl(env),
    databaseUrl: resolveDatabaseUrl(env),
    publicUrl: resolvePublicUrl(env),
    jwtSecret: requireJwtSecret(env),
    resendApiKey: policy.email.resendApiKey,
    resendFromEmail: policy.email.resendFromEmail,
    mockEmailDelivery: policy.email.mockDelivery,
    emailDeliveryMode: policy.email.deliveryMode,
    allowSelfServiceOrgs: policy.allowSelfServiceOrgs,
    allowOrgDirectory: policy.allowOrgDirectory,
    pushNotificationsEnabled: policy.push.enabled,
    billingMode: policy.billingMode,
    platformAdminEmails: policy.platformAdminEmails,
    stripe: policy.stripe,
  };
}

export function assertRuntimeSecretsConfigured(env: RuntimeEnv = process.env): void {
  const runtimeConfig = resolveRuntimeConfig(env);
  const gatewayConfig = resolveGatewayConfig(undefined, env);
  void runtimeConfig.jwtSecret;
  void runtimeConfig.publicUrl;
  void gatewayConfig.corsOrigins;

  assertRuntimeEnvironmentPolicyConfigured(env);

  if (!gatewayConfig.corsOrigins.includes(gatewayConfig.publicOrigin)) {
    throw new Error('CORS_ORIGINS must include the PUBLIC_URL origin');
  }
}
