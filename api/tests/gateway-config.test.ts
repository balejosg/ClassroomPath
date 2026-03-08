import assert from 'node:assert';
import { describe, test } from 'node:test';

import { resolveGatewayConfig } from '../src/lib/gateway-config.js';

await describe('gateway config', async () => {
  await test('uses gateway defaults when env vars are missing', () => {
    const config = resolveGatewayConfig({}, { NODE_ENV: 'test' });

    assert.deepStrictEqual(config, {
      authRateLimitMax: 5,
      authRateLimitWindowMs: 60_000,
      corsOrigins: ['http://localhost:5173'],
      enableRateLimit: false,
      jsonBodyLimit: '64kb',
      onboardingRateLimitMax: 5,
      onboardingRateLimitWindowMs: 60_000,
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
        CP_ONBOARDING_RATE_LIMIT_MAX: '3',
        CP_ONBOARDING_RATE_LIMIT_WINDOW_MS: '90000',
        CP_JSON_LIMIT: '32kb',
        CORS_ORIGINS: 'https://a.example, https://b.example',
      }
    );

    assert.deepStrictEqual(config, {
      authRateLimitMax: 7,
      authRateLimitWindowMs: 120_000,
      corsOrigins: ['https://a.example', 'https://b.example'],
      enableRateLimit: true,
      jsonBodyLimit: '1kb',
      onboardingRateLimitMax: 9,
      onboardingRateLimitWindowMs: 90_000,
    });
  });
});
