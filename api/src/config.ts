export {
  assertRuntimeSecretsConfigured,
  requireJwtSecret,
  resolveEmailDeliveryMode,
  resolveMockEmailDelivery,
  resolveOpenPathUrl,
  resolvePort,
  resolvePublicUrl,
  resolveRuntimeConfig,
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
export { DEFAULT_JWT_SECRET, type RuntimeEnv } from './config/shared.js';
import { resolveDatabaseUrl } from './lib/database-url.js';
import {
  requireJwtSecret,
  resolveEmailDeliveryMode,
  resolveMockEmailDelivery,
  resolveOpenPathUrl,
  resolvePort,
  resolvePublicUrl,
  resolveRuntimeConfig,
} from './config/runtime.js';
import {
  resolveBillingMode,
  resolvePlatformAdminEmails,
  resolveStripeConfig,
  type BillingMode,
  type EmailDeliveryMode,
} from './config/billing.js';
import { parseBooleanEnv, trimToNull } from './config/shared.js';

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
  get vapidPublicKey() {
    return trimToNull(process.env.VAPID_PUBLIC_KEY) ?? '';
  },
  get vapidPrivateKey() {
    return trimToNull(process.env.VAPID_PRIVATE_KEY) ?? '';
  },
  get vapidContact() {
    return (
      trimToNull(process.env.VAPID_CONTACT) ??
      trimToNull(process.env.VAPID_SUBJECT) ??
      `mailto:admin@${new URL(resolvePublicUrl(process.env)).hostname}`
    );
  },
};
