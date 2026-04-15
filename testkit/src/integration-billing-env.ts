export const TEST_PUBLIC_URL = 'http://localhost:5173';
export const TEST_PLATFORM_ADMIN_EMAIL = 'platform-admin@classroompath.test';
export const TEST_STRIPE_SECRET_KEY = 'sk_test_integration_harness';
export const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_integration_harness';
export const TEST_STRIPE_PRICE_ID = 'price_integration_harness';

export function applyBillingRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  env.PUBLIC_URL ??= TEST_PUBLIC_URL;
  env.CORS_ORIGINS ??= env.PUBLIC_URL ?? TEST_PUBLIC_URL;
  env.CP_PLATFORM_ADMIN_EMAILS ??= TEST_PLATFORM_ADMIN_EMAIL;
  env.STRIPE_SECRET_KEY ??= TEST_STRIPE_SECRET_KEY;
  env.STRIPE_WEBHOOK_SECRET ??= TEST_STRIPE_WEBHOOK_SECRET;
  env.STRIPE_ANNUAL_PRICE_1_10 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_ANNUAL_PRICE_11_25 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_ANNUAL_PRICE_26_50 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_ANNUAL_PRICE_51_100 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_ONBOARDING_PRICE_1_25 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_ONBOARDING_PRICE_26_100 ??= TEST_STRIPE_PRICE_ID;
  env.STRIPE_PILOT_PRICE ??= TEST_STRIPE_PRICE_ID;
}
