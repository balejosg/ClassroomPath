import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('runtime environment policy', () => {
  it('centralizes billing, Stripe, push, email, and canary runtime policy', async () => {
    const policyModule = await import('../src/config/runtime-environment-policy.ts');

    assert.deepEqual(policyModule.OPTIONAL_BILLING_ENV_NAMES, [
      'CP_ALLOW_SELF_SERVICE_ORGS',
      'CP_CLIENT_CANARY_ADMIN_TOKEN',
    ]);
    assert.deepEqual(policyModule.BILLING_BASE_REQUIRED_ENV_NAMES, [
      'CP_BILLING_MODE',
      'CP_PLATFORM_ADMIN_EMAILS',
    ]);
    assert.deepEqual(policyModule.STRIPE_REQUIRED_ENV_NAMES, [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_ANNUAL_PRICE_1_10',
      'STRIPE_ANNUAL_PRICE_11_25',
      'STRIPE_ANNUAL_PRICE_26_50',
      'STRIPE_ANNUAL_PRICE_51_100',
      'STRIPE_ONBOARDING_PRICE_1_25',
      'STRIPE_ONBOARDING_PRICE_26_100',
      'STRIPE_PILOT_PRICE',
    ]);
    assert.deepEqual(policyModule.PUSH_ENV_NAMES, [
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_CONTACT',
    ]);
    assert.deepEqual(policyModule.STAGING_EMAIL_PREFLIGHT_MODES, ['auto', 'required', 'skip']);

    const policy = policyModule.resolveRuntimeEnvironmentPolicy({
      CP_BILLING_MODE: 'manual_only',
      CP_PLATFORM_ADMIN_EMAILS: ' Ops@example.com , billing@example.com ',
      CP_CLIENT_CANARY_ADMIN_TOKEN: 'canary-token',
      CP_FAKE_EMAIL_DELIVERY: '1',
      CP_EMAIL_PREFLIGHT_MODE: 'skip',
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_CONTACT: 'mailto:ops@classroompath.example.invalid',
    });

    assert.equal(policy.billingMode, 'manual_only');
    assert.deepEqual(policy.platformAdminEmails, ['ops@example.com', 'billing@example.com']);
    assert.equal(policy.clientCanaryAdminToken, 'canary-token');
    assert.equal(policy.email.deliveryMode, 'mock');
    assert.equal(policy.email.preflightMode, 'skip');
    assert.equal(policy.push.enabled, true);
  });

  it('keeps Stripe and push validation messages compatible with existing runtime config', async () => {
    const policyModule = await import('../src/config/runtime-environment-policy.ts');

    assert.throws(
      () =>
        policyModule.assertRuntimeEnvironmentPolicyConfigured({
          CP_BILLING_MODE: 'stripe',
          CP_PLATFORM_ADMIN_EMAILS: 'ops@classroompath.example.invalid',
          STRIPE_SECRET_KEY: 'sk_test_classroompath',
          STRIPE_WEBHOOK_SECRET: 'whsec_classroompath',
        }),
      /All STRIPE_\* price ids must be set when billing-gated onboarding is enabled/
    );

    assert.throws(
      () =>
        policyModule.assertRuntimeEnvironmentPolicyConfigured({
          CP_BILLING_MODE: 'manual_only',
          CP_PLATFORM_ADMIN_EMAILS: 'ops@classroompath.example.invalid',
          CP_REQUIRE_PUSH_NOTIFICATIONS: '1',
          VAPID_PUBLIC_KEY: 'public-key',
          VAPID_CONTACT: 'mailto:ops@classroompath.example.invalid',
        }),
      /VAPID_PRIVATE_KEY must be set for push notifications/
    );
  });

  it('validates PUBLIC_URL even when push contact is configured explicitly', async () => {
    const policyModule = await import('../src/config/runtime-environment-policy.ts');

    assert.throws(
      () =>
        policyModule.resolvePushRuntimePolicy({
          NODE_ENV: 'production',
          PUBLIC_URL: ' https://classroompath.example.invalid',
          VAPID_CONTACT: 'mailto:ops@classroompath.example.invalid',
        }),
      /PUBLIC_URL must be a bare http\(s\) origin/
    );
  });
});
