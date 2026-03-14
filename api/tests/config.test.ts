import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const ORIGINAL_ENV = {
  CP_ALLOW_ORG_DIRECTORY: process.env.CP_ALLOW_ORG_DIRECTORY,
  CP_ALLOW_SELF_SERVICE_ORGS: process.env.CP_ALLOW_SELF_SERVICE_ORGS,
  CP_FAKE_EMAIL_DELIVERY: process.env.CP_FAKE_EMAIL_DELIVERY,
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_URL: process.env.PUBLIC_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
};

function restoreEnv(): void {
  setEnv('CP_ALLOW_ORG_DIRECTORY', ORIGINAL_ENV.CP_ALLOW_ORG_DIRECTORY);
  setEnv('CP_ALLOW_SELF_SERVICE_ORGS', ORIGINAL_ENV.CP_ALLOW_SELF_SERVICE_ORGS);
  setEnv('CP_FAKE_EMAIL_DELIVERY', ORIGINAL_ENV.CP_FAKE_EMAIL_DELIVERY);
  setEnv('JWT_SECRET', ORIGINAL_ENV.JWT_SECRET);
  setEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
  setEnv('PUBLIC_URL', ORIGINAL_ENV.PUBLIC_URL);
  setEnv('RESEND_API_KEY', ORIGINAL_ENV.RESEND_API_KEY);
  setEnv('RESEND_FROM_EMAIL', ORIGINAL_ENV.RESEND_FROM_EMAIL);
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnv();
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

  it('enables self-service organization creation by default in production while keeping the directory hidden', async () => {
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

    assert.equal(runtimeConfig.allowSelfServiceOrgs, true);
    assert.equal(runtimeConfig.allowOrgDirectory, false);
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
