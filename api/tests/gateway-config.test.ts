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

  await test('rejects localhost and loopback PUBLIC_URL values in the gateway boundary', () => {
    for (const publicUrl of [
      'http://localhost',
      'http://localhost.',
      'http://127.0.0.1',
      'http://127.0.0.2',
      'http://127.255.255.255',
      'http://[::1]',
      'http://[0:0:0:0:0:0:0:1]',
      'http://[::ffff:127.0.0.1]',
      'http://[::ffff:7f00:1]',
    ]) {
      assert.throws(
        () =>
          resolveGatewayConfig(
            {},
            {
              NODE_ENV: 'production',
              PUBLIC_URL: publicUrl,
              CORS_ORIGINS: 'https://classroompath.test',
            }
          ),
        /PUBLIC_URL|localhost/u,
        publicUrl
      );
    }
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

  await test('uses the strict bare-origin contract for CORS origins', () => {
    for (const corsOrigin of [
      'https://classroompath.test/app',
      'https://classroompath.test\\gateway',
      'https://classroompath.test?',
      'https://classroompath.test#fragment',
    ]) {
      assert.throws(
        () =>
          resolveGatewayConfig(
            {},
            {
              NODE_ENV: 'production',
              PUBLIC_URL: 'https://classroompath.test',
              CORS_ORIGINS: corsOrigin,
            }
          ),
        /CORS origins|bare.*origin/u,
        corsOrigin
      );
    }
  });

  await test('rejects a missing or non-origin PUBLIC_URL in the gateway boundary', () => {
    const invalidPublicUrls = [
      undefined,
      'https://classroompath.test/app',
      'https://classroompath.test/./',
      'https://classroompath.test/%2e%2e',
      'https://@classroompath.test',
      'https://user:password@classroompath.test',
      'https://classroompath.test?tenant=one',
      'https://classroompath.test?',
      'https://classroompath.test#fragment',
      'https://classroompath.test#',
      ' https://classroompath.test',
      'https://classroompath.test ',
    ];

    for (const publicUrl of invalidPublicUrls) {
      assert.throws(
        () =>
          resolveGatewayConfig(
            {},
            {
              NODE_ENV: 'production',
              ...(publicUrl === undefined ? {} : { PUBLIC_URL: publicUrl }),
              CORS_ORIGINS: 'https://classroompath.test',
            }
          ),
        /PUBLIC_URL|origin/u
      );
    }
  });
});
