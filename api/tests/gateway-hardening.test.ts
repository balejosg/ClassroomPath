import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  buildGatewayContentSecurityPolicy,
  createGatewayErrorBody,
  createGatewayRateLimitRules,
  isPayloadTooLargeError,
} from '../src/lib/gateway-hardening.js';

await describe('gateway hardening helpers', async () => {
  await test('buildGatewayContentSecurityPolicy includes local dev origins outside production', () => {
    const policy = buildGatewayContentSecurityPolicy('test');

    assert.match(policy, /connect-src/);
    assert.match(policy, /http:\/\/localhost:\*/);
    assert.match(policy, /ws:\/\/localhost:\*/);
  });

  await test('buildGatewayContentSecurityPolicy excludes local dev origins in production', () => {
    const policy = buildGatewayContentSecurityPolicy('production');

    assert.doesNotMatch(policy, /localhost/);
    assert.doesNotMatch(policy, /ws:\/\//);
    assert.match(policy, /style-src[^;]*accounts\.google\.com/);
  });

  await test('createGatewayRateLimitRules matches the hardened auth and onboarding procedures', () => {
    const rules = createGatewayRateLimitRules({
      authRateLimitMax: 5,
      authRateLimitWindowMs: 60_000,
      onboardingRateLimitMax: 5,
      onboardingRateLimitWindowMs: 60_000,
    });

    const authRule = rules.find((rule) => rule.bucket === 'auth');
    const onboardingRule = rules.find((rule) => rule.bucket === 'onboarding');

    assert.ok(authRule);
    assert.ok(onboardingRule);
    assert.strictEqual(authRule?.matches('/cp/trpc/auth.login'), true);
    assert.strictEqual(authRule?.matches('/trpc/auth.resetPassword?batch=1'), true);
    assert.strictEqual(authRule?.matches('/cp/trpc/onboarding.waitForInvitation'), false);
    assert.strictEqual(onboardingRule?.matches('/cp/trpc/onboarding.waitForInvitation'), true);
    assert.strictEqual(onboardingRule?.matches('/cp/trpc/auth.login'), false);
  });

  await test('createGatewayErrorBody keeps the code aligned in the top-level error and nested data', () => {
    const body = createGatewayErrorBody('TOO_MANY_REQUESTS', 'Too many requests', {
      requestId: 'req-123',
      retryAfterMs: 1500,
    });

    assert.deepStrictEqual(body, {
      error: {
        message: 'Too many requests',
        code: 'TOO_MANY_REQUESTS',
        data: {
          code: 'TOO_MANY_REQUESTS',
          requestId: 'req-123',
          retryAfterMs: 1500,
        },
      },
    });
  });

  await test('isPayloadTooLargeError recognizes body parser 413 variants', () => {
    assert.strictEqual(isPayloadTooLargeError({ status: 413 }), true);
    assert.strictEqual(isPayloadTooLargeError({ statusCode: 413 }), true);
    assert.strictEqual(isPayloadTooLargeError({ type: 'entity.too.large' }), true);
    assert.strictEqual(isPayloadTooLargeError({ status: 400 }), false);
  });
});
