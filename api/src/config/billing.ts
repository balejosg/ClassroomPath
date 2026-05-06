import {
  assertBillingPolicyConfigured,
  resolveBillingMode,
  resolvePlatformAdminEmails,
  resolveStripeConfig,
  type BillingMode,
  type EmailDeliveryMode,
  type StripeRuntimeConfig,
  type RuntimeEnvironmentPolicy,
  type RuntimeEnv,
} from './runtime-environment-policy.js';

export {
  resolveBillingMode,
  resolvePlatformAdminEmails,
  resolveStripeConfig,
  type BillingMode,
  type EmailDeliveryMode,
  type RuntimeEnv,
  type StripeRuntimeConfig,
};

export type BillingRuntimeConfig = Pick<
  RuntimeEnvironmentPolicy,
  'allowOrgDirectory' | 'allowSelfServiceOrgs' | 'billingMode' | 'platformAdminEmails' | 'stripe'
>;

export function assertBillingRuntimeConfigured(runtimeConfig: BillingRuntimeConfig): void {
  assertBillingPolicyConfigured(runtimeConfig);
}
