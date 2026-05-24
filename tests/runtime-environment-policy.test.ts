import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BILLING_BASE_REQUIRED_ENV_NAMES,
  OPTIONAL_BILLING_ENV_NAMES,
  PUSH_ENV_NAMES,
  STAGING_EMAIL_PREFLIGHT_MODES,
  STRIPE_REQUIRED_ENV_NAMES,
  listMissingBillingEnv,
  resolveStagingEmailPreflightPolicy,
} from '../scripts/lib/runtime-environment-policy.mjs';

describe('runtime environment policy script adapter', () => {
  test('loads billing, Stripe, push, optional billing, and staging email modes from the catalog', () => {
    assert.deepEqual(BILLING_BASE_REQUIRED_ENV_NAMES, [
      'CP_BILLING_MODE',
      'CP_PLATFORM_ADMIN_EMAILS',
    ]);
    assert.deepEqual(STRIPE_REQUIRED_ENV_NAMES, [
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
    assert.deepEqual(OPTIONAL_BILLING_ENV_NAMES, [
      'CP_ALLOW_SELF_SERVICE_ORGS',
      'CP_CLIENT_CANARY_ADMIN_TOKEN',
    ]);
    assert.deepEqual(PUSH_ENV_NAMES, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_CONTACT']);
    assert.deepEqual(STAGING_EMAIL_PREFLIGHT_MODES, ['auto', 'required', 'skip']);
  });

  test('does not require platform admins when self-service organization creation is enabled', () => {
    assert.deepEqual(
      listMissingBillingEnv({
        CP_ALLOW_SELF_SERVICE_ORGS: '1',
        CP_BILLING_MODE: 'manual_only',
      }),
      []
    );
  });

  test('reports invalid billing mode as CP_BILLING_MODE', () => {
    assert.deepEqual(
      listMissingBillingEnv({
        CP_BILLING_MODE: 'invalid',
        CP_PLATFORM_ADMIN_EMAILS: 'ops@classroompath.example.invalid',
      }),
      ['CP_BILLING_MODE']
    );
  });

  test('fails closed for invalid staging email preflight modes', () => {
    assert.throws(
      () => resolveStagingEmailPreflightPolicy({ mode: 'invalid', highRisk: 'false' }),
      /Invalid STAGING_EMAIL_PREFLIGHT_MODE/
    );
  });
});
