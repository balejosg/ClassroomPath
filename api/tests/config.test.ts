import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { restoreTrackedEnv, setEnv, snapshotTrackedEnv } from './helpers/env.js';

const ORIGINAL_ENV = snapshotTrackedEnv();

afterEach(() => {
  restoreTrackedEnv(ORIGINAL_ENV);
});

describe('runtime config contract', () => {
  it('uses the localhost PUBLIC_URL fallback in test mode', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    delete process.env.PUBLIC_URL;

    const tag = `runtime-config-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.equal(configModule.resolveRuntimeConfig().publicUrl, 'http://localhost:5173');
  });

  it('rejects a missing PUBLIC_URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    delete process.env.PUBLIC_URL;

    const tag = `runtime-config-production-missing-url-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.throws(() => configModule.assertRuntimeSecretsConfigured(), /PUBLIC_URL/i);
  });

  it('rejects localhost PUBLIC_URL values in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'http://localhost:5173/';

    const tag = `runtime-config-production-localhost-url-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.throws(() => configModule.resolveRuntimeConfig(), /PUBLIC_URL/i);
  });

  it('disables self-service organization creation by default in production while keeping the directory hidden', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.eu';
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
    delete process.env.CP_ALLOW_ORG_DIRECTORY;

    const tag = `runtime-config-production-onboarding-policy-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);
    const runtimeConfig = configModule.resolveRuntimeConfig();

    assert.equal(runtimeConfig.allowSelfServiceOrgs, false);
    assert.equal(runtimeConfig.allowOrgDirectory, false);
  });

  it('allows manual-only billing mode without Stripe secrets', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.eu';
    process.env.CORS_ORIGINS = 'https://classroompath.eu';
    process.env.CP_BILLING_MODE = 'manual_only';
    process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.eu';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_ANNUAL_PRICE_1_10;
    delete process.env.STRIPE_ANNUAL_PRICE_11_25;
    delete process.env.STRIPE_ANNUAL_PRICE_26_50;
    delete process.env.STRIPE_ANNUAL_PRICE_51_100;
    delete process.env.STRIPE_ONBOARDING_PRICE_1_25;
    delete process.env.STRIPE_ONBOARDING_PRICE_26_100;
    delete process.env.STRIPE_PILOT_PRICE;

    const tag = `runtime-config-manual-only-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);
    const runtimeConfig = configModule.resolveRuntimeConfig();

    assert.equal(runtimeConfig.billingMode, 'manual_only');
    assert.equal(runtimeConfig.stripe.secretKey, null);
    assert.doesNotThrow(() => configModule.assertRuntimeSecretsConfigured());
  });

  it('resolves the Stripe checkout and platform admin runtime contract', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.eu';
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.CP_PLATFORM_ADMIN_EMAILS = ' Admin@ClassroomPath.eu, billing@example.com ';
    process.env.STRIPE_SECRET_KEY = 'sk_test_classroompath';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_classroompath';
    process.env.STRIPE_ANNUAL_PRICE_1_10 = 'price_annual_1_10';
    process.env.STRIPE_ANNUAL_PRICE_11_25 = 'price_annual_11_25';
    process.env.STRIPE_ANNUAL_PRICE_26_50 = 'price_annual_26_50';
    process.env.STRIPE_ANNUAL_PRICE_51_100 = 'price_annual_51_100';
    process.env.STRIPE_ONBOARDING_PRICE_1_25 = 'price_onboarding_1_25';
    process.env.STRIPE_ONBOARDING_PRICE_26_100 = 'price_onboarding_26_100';
    process.env.STRIPE_PILOT_PRICE = 'price_pilot';

    const tag = `runtime-config-stripe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);
    const runtimeConfig = configModule.resolveRuntimeConfig();

    assert.equal(runtimeConfig.stripe.secretKey, 'sk_test_classroompath');
    assert.equal(runtimeConfig.stripe.webhookSecret, 'whsec_classroompath');
    assert.equal(runtimeConfig.stripe.priceIds.annual['11_25'], 'price_annual_11_25');
    assert.equal(runtimeConfig.stripe.priceIds.onboarding['26_100'], 'price_onboarding_26_100');
    assert.equal(runtimeConfig.stripe.priceIds.pilot, 'price_pilot');
    assert.deepEqual(runtimeConfig.platformAdminEmails, [
      'admin@classroompath.eu',
      'billing@example.com',
    ]);
  });

  it('requires the public origin to be present in CORS_ORIGINS', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.eu';
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.CORS_ORIGINS = 'https://staging.classroompath.eu';
    process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.eu';
    process.env.STRIPE_SECRET_KEY = 'sk_test_classroompath';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_classroompath';
    process.env.STRIPE_ANNUAL_PRICE_1_10 = 'price_annual_1_10';
    process.env.STRIPE_ANNUAL_PRICE_11_25 = 'price_annual_11_25';
    process.env.STRIPE_ANNUAL_PRICE_26_50 = 'price_annual_26_50';
    process.env.STRIPE_ANNUAL_PRICE_51_100 = 'price_annual_51_100';
    process.env.STRIPE_ONBOARDING_PRICE_1_25 = 'price_onboarding_1_25';
    process.env.STRIPE_ONBOARDING_PRICE_26_100 = 'price_onboarding_26_100';
    process.env.STRIPE_PILOT_PRICE = 'price_pilot';

    const tag = `runtime-config-cors-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.throws(
      () => configModule.assertRuntimeSecretsConfigured(),
      /CORS_ORIGINS must include the PUBLIC_URL origin/
    );
  });

  it('derives the email delivery mode from the runtime env contract', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.PUBLIC_URL = 'https://classroompath.test';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    process.env.CP_FAKE_EMAIL_DELIVERY = '1';

    const tag = `runtime-config-email-mode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.equal(configModule.resolveRuntimeConfig().emailDeliveryMode, 'mock');

    delete process.env.CP_FAKE_EMAIL_DELIVERY;
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';

    assert.equal(configModule.resolveRuntimeConfig().emailDeliveryMode, 'resend');
  });
});
