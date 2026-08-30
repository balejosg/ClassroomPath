import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { restoreTrackedEnv, setEnv, snapshotTrackedEnv } from './helpers/env.js';

const ORIGINAL_ENV = snapshotTrackedEnv();
const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));

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

  it('rejects all supported localhost and loopback PUBLIC_URL forms in production', async () => {
    for (const publicUrl of [
      'http://localhost',
      'http://localhost:5173/',
      'http://localhost.',
      'http://127.0.0.1',
      'http://127.0.0.2',
      'http://127.255.255.255',
      'http://[::1]',
      'http://[0:0:0:0:0:0:0:1]',
      'http://[::ffff:127.0.0.1]',
      'http://[::ffff:7f00:1]',
    ]) {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'production-secret-value';
      process.env.PUBLIC_URL = publicUrl;

      const tag = `runtime-config-production-localhost-url-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const configModule = await import(`../src/config.ts?${tag}`);

      assert.throws(() => configModule.resolveRuntimeConfig(), /PUBLIC_URL/i, publicUrl);
    }
  });

  it('disables self-service organization creation by default in production while keeping the directory hidden', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.example.invalid';
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
    process.env.PUBLIC_URL = 'https://classroompath.example.invalid';
    process.env.CORS_ORIGINS = 'https://classroompath.example.invalid';
    process.env.CP_BILLING_MODE = 'manual_only';
    process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.example.invalid';
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
    process.env.PUBLIC_URL = 'https://classroompath.example.invalid';
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.CP_PLATFORM_ADMIN_EMAILS = ' Admin@example.com, billing@example.com ';
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
      'admin@example.com',
      'billing@example.com',
    ]);
  });

  it('requires the public origin to be present in CORS_ORIGINS', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.example.invalid';
    process.env.CP_BILLING_MODE = 'stripe';
    process.env.CORS_ORIGINS = 'https://staging.classroompath.example.invalid';
    process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.example.invalid';
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

  it('requires complete VAPID configuration when push notifications are required', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-value';
    process.env.PUBLIC_URL = 'https://classroompath.example.invalid';
    process.env.CORS_ORIGINS = 'https://classroompath.example.invalid';
    process.env.CP_BILLING_MODE = 'manual_only';
    process.env.CP_PLATFORM_ADMIN_EMAILS = 'ops@classroompath.example.invalid';
    process.env.CP_REQUIRE_PUSH_NOTIFICATIONS = '1';
    process.env.VAPID_PUBLIC_KEY = 'public-key';
    delete process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_CONTACT = 'mailto:ops@classroompath.example.invalid';

    const tag = `runtime-config-required-push-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.throws(() => configModule.assertRuntimeSecretsConfigured(), /VAPID_PRIVATE_KEY/);

    process.env.VAPID_PRIVATE_KEY = 'private-key';

    assert.doesNotThrow(() => configModule.assertRuntimeSecretsConfigured());
    assert.equal(configModule.resolveRuntimeConfig().pushNotificationsEnabled, true);
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

  it('routes public email config getters through narrow runtime policy resolvers', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'noreply@classroompath.test';

    const tag = `runtime-config-email-getters-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);
    const configSource = readFileSync(resolve(apiDir, 'src/config.ts'), 'utf8');

    assert.ok(configSource.includes('resolveResendApiKey(process.env)'));
    assert.ok(configSource.includes('resolveResendFromEmail(process.env)'));
    assert.ok(!configSource.includes('trimToNull(process.env.RESEND_API_KEY)'));
    assert.ok(!configSource.includes('trimToNull(process.env.RESEND_FROM_EMAIL)'));
    assert.equal(configModule.config.resendApiKey, 're_test_123');
    assert.equal(configModule.config.resendFromEmail, 'noreply@classroompath.test');
  });

  it('reads the client canary token without validating unrelated email preflight policy', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.CP_CLIENT_CANARY_ADMIN_TOKEN = 'expected-token';
    process.env.CP_EMAIL_PREFLIGHT_MODE = 'bogus';

    const tag = `runtime-config-canary-token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = await import(`../src/config.ts?${tag}`);

    assert.equal(configModule.config.clientCanaryAdminToken, 'expected-token');
    assert.throws(
      () => configModule.assertRuntimeSecretsConfigured(),
      /CP_EMAIL_PREFLIGHT_MODE must be one of: required, skip/
    );
  });
});
