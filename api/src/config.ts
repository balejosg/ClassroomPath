export {
  assertPushRuntimeConfigured,
  assertRuntimeSecretsConfigured,
  requireJwtSecret,
  resolveEmailDeliveryMode,
  resolveMockEmailDelivery,
  resolveOpenPathUrl,
  resolvePort,
  resolvePublicUrl,
  resolvePushRuntimeConfig,
  resolveRuntimeConfig,
  type PushRuntimeConfig,
  type RuntimeConfig,
} from './config/runtime.js';
export {
  assertBillingRuntimeConfigured,
  resolveBillingMode,
  resolvePlatformAdminEmails,
  resolveStripeConfig,
  type BillingMode,
  type EmailDeliveryMode,
  type StripeRuntimeConfig,
} from './config/billing.js';
export {
  BILLING_BASE_REQUIRED_ENV_NAMES,
  OPTIONAL_BILLING_ENV_NAMES,
  PUSH_ENV_NAMES,
  STRIPE_REQUIRED_ENV_NAMES,
  resolveClientCanaryAdminToken,
  resolveResendApiKey,
  resolveResendFromEmail,
  resolveRuntimeEnvironmentPolicy,
  type EmailPreflightMode,
  type RuntimeEnvironmentPolicy,
} from './config/runtime-environment-policy.js';
export { DEFAULT_JWT_SECRET, type RuntimeEnv } from './config/shared.js';
import { resolveDatabaseUrl } from './lib/database-url.js';
import {
  requireJwtSecret,
  resolveEmailDeliveryMode,
  resolveMockEmailDelivery,
  resolveOpenPathUrl,
  resolvePort,
  resolvePublicUrl,
  resolvePushRuntimeConfig,
  resolveRuntimeConfig,
  type PushRuntimeConfig,
} from './config/runtime.js';
import { type BillingMode, type EmailDeliveryMode } from './config/billing.js';
import {
  resolveClientCanaryAdminToken,
  resolveResendApiKey,
  resolveResendFromEmail,
  resolveRuntimeEnvironmentPolicy,
} from './config/runtime-environment-policy.js';

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
    return resolveResendApiKey(process.env);
  },
  get resendFromEmail() {
    return resolveResendFromEmail(process.env);
  },
  get mockEmailDelivery() {
    return resolveMockEmailDelivery(process.env);
  },
  get emailDeliveryMode(): EmailDeliveryMode {
    return resolveEmailDeliveryMode(process.env);
  },
  get allowSelfServiceOrgs() {
    return resolveRuntimeEnvironmentPolicy(process.env).allowSelfServiceOrgs;
  },
  get allowOrgDirectory() {
    return resolveRuntimeEnvironmentPolicy(process.env).allowOrgDirectory;
  },
  get billingMode(): BillingMode {
    return resolveRuntimeEnvironmentPolicy(process.env).billingMode;
  },
  get platformAdminEmails() {
    return resolveRuntimeEnvironmentPolicy(process.env).platformAdminEmails;
  },
  get clientCanaryAdminToken() {
    return resolveClientCanaryAdminToken(process.env);
  },
  get stripe() {
    return resolveRuntimeEnvironmentPolicy(process.env).stripe;
  },
  get pushNotificationsEnabled() {
    return resolvePushRuntimeConfig(process.env).enabled;
  },
  get push(): PushRuntimeConfig {
    return resolvePushRuntimeConfig(process.env);
  },
  get vapidPublicKey() {
    return resolvePushRuntimeConfig(process.env).publicKey;
  },
  get vapidPrivateKey() {
    return resolvePushRuntimeConfig(process.env).privateKey;
  },
  get vapidContact() {
    return resolvePushRuntimeConfig(process.env).contact;
  },
};
