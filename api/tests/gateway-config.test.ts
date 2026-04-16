import assert from 'node:assert';
import { describe, test } from 'node:test';

import { resolveGatewayConfig } from '../src/lib/gateway-config.js';
import { restoreTrackedEnv, snapshotTrackedEnv } from './helpers/env.js';

const ORIGINAL_ENV = snapshotTrackedEnv();

test.afterEach(() => {
  restoreTrackedEnv(ORIGINAL_ENV);
});

await describe('gateway config', async () => {
  await test('uses gateway defaults when env vars are missing', () => {
    const config = resolveGatewayConfig({}, { NODE_ENV: 'test' });

    assert.deepStrictEqual(config, {
      authRateLimitMax: 5,
      authRateLimitWindowMs: 60_000,
      agentDeliveryRateLimitMax: 500,
      agentDeliveryRateLimitWindowMs: 60_000,
      corsOrigins: ['http://localhost:5173'],
      enableRateLimit: false,
      globalRateLimitMax: 120,
      globalRateLimitWindowMs: 60_000,
      jsonBodyLimit: '64kb',
      onboardingRateLimitMax: 5,
      onboardingRateLimitWindowMs: 60_000,
      publicOrigin: 'http://localhost:5173',
      serveSpa: true,
    });
  });

  await test('applies env vars and explicit option overrides', () => {
    const config = resolveGatewayConfig(
      {
        jsonBodyLimit: '1kb',
        onboardingRateLimitMax: 9,
      },
      {
        NODE_ENV: 'test',
        CP_ENABLE_RATE_LIMIT_IN_TEST: 'true',
        CP_AUTH_RATE_LIMIT_MAX: '7',
        CP_AUTH_RATE_LIMIT_WINDOW_MS: '120000',
        CP_AGENT_DELIVERY_RATE_LIMIT_MAX: '450',
        CP_AGENT_DELIVERY_RATE_LIMIT_WINDOW_MS: '30000',
        CP_ONBOARDING_RATE_LIMIT_MAX: '3',
        CP_ONBOARDING_RATE_LIMIT_WINDOW_MS: '90000',
        CP_SERVE_SPA: 'false',
        CP_JSON_LIMIT: '32kb',
        CORS_ORIGINS: 'https://a.example, https://b.example',
      }
    );

    assert.deepStrictEqual(config, {
      authRateLimitMax: 7,
      authRateLimitWindowMs: 120_000,
      agentDeliveryRateLimitMax: 450,
      agentDeliveryRateLimitWindowMs: 30_000,
      corsOrigins: ['https://a.example', 'https://b.example'],
      enableRateLimit: true,
      globalRateLimitMax: 120,
      globalRateLimitWindowMs: 60_000,
      jsonBodyLimit: '1kb',
      onboardingRateLimitMax: 9,
      onboardingRateLimitWindowMs: 90_000,
      publicOrigin: 'http://localhost:5173',
      serveSpa: false,
    });
  });

  await test('rejects missing CORS_ORIGINS in production', () => {
    assert.throws(
      () =>
        resolveGatewayConfig(
          {},
          { NODE_ENV: 'production', PUBLIC_URL: 'https://classroompath.test' }
        ),
      /CORS_ORIGINS/i
    );
  });

  await test('rejects localhost CORS origins in production', () => {
    assert.throws(
      () =>
        resolveGatewayConfig(
          {},
          {
            NODE_ENV: 'production',
            PUBLIC_URL: 'https://classroompath.test',
            CORS_ORIGINS: 'http://localhost:5173',
          }
        ),
      /non-localhost/i
    );
  });
});
