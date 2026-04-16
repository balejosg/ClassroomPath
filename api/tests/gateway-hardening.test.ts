import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  buildGatewayContentSecurityPolicy,
  createGatewayCorsOriginResolver,
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
      agentDeliveryRateLimitMax: 500,
      agentDeliveryRateLimitWindowMs: 60_000,
      globalRateLimitMax: 50,
      globalRateLimitWindowMs: 60_000,
      onboardingRateLimitMax: 5,
      onboardingRateLimitWindowMs: 60_000,
    });

    const globalRule = rules.find((rule) => rule.bucket === 'global');
    const authRule = rules.find((rule) => rule.bucket === 'auth');
    const agentDeliveryRule = rules.find((rule) => rule.bucket === 'agentDelivery');
    const onboardingRule = rules.find((rule) => rule.bucket === 'onboarding');

    assert.ok(globalRule);
    assert.ok(authRule);
    assert.ok(agentDeliveryRule);
    assert.ok(onboardingRule);
    assert.strictEqual(globalRule?.matches('/cp/trpc/users.list'), true);
    assert.strictEqual(globalRule?.matches('/cp/health'), false);
    assert.strictEqual(globalRule?.matches('/api/agent/windows/bootstrap/latest.json'), false);
    assert.strictEqual(
      globalRule?.matches(
        '/api/agent/windows/bootstrap/file?path=runtime%2Fbrowser-policy-spec.json'
      ),
      false
    );
    assert.strictEqual(globalRule?.matches('/api/agent/windows/latest.json'), false);
    assert.strictEqual(globalRule?.matches('/api/agent/linux/latest.json'), false);
    assert.strictEqual(authRule?.matches('/cp/trpc/auth.login'), true);
    assert.strictEqual(authRule?.matches('/cp/trpc/auth.googleSignup'), true);
    assert.strictEqual(authRule?.matches('/trpc/auth.resetPassword?batch=1'), true);
    assert.strictEqual(authRule?.matches('/cp/trpc/onboarding.waitForInvitation'), false);
    assert.strictEqual(
      agentDeliveryRule?.matches('/api/agent/windows/bootstrap/latest.json'),
      true
    );
    assert.strictEqual(
      agentDeliveryRule?.matches(
        '/api/agent/windows/bootstrap/file?path=runtime%2Fbrowser-policy-spec.json'
      ),
      true
    );
    assert.strictEqual(
      agentDeliveryRule?.matches('/api/agent/windows/bootstrap/files/Install-OpenPath.ps1'),
      true
    );
    assert.strictEqual(agentDeliveryRule?.matches('/api/agent/windows/latest.json'), true);
    assert.strictEqual(
      agentDeliveryRule?.matches('/api/agent/windows/file?path=OpenPath.ps1'),
      true
    );
    assert.strictEqual(agentDeliveryRule?.matches('/api/agent/linux/latest.json'), true);
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

  await test('createGatewayCorsOriginResolver only allows configured origins', async () => {
    const resolver = createGatewayCorsOriginResolver(['https://classroompath.test']);

    const allowed = await new Promise<boolean>((resolve, reject) => {
      resolver('https://classroompath.test', (error, value) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(value ?? false);
      });
    });

    const rejected = await new Promise<boolean>((resolve, reject) => {
      resolver('https://evil.test', (error, value) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(value ?? false);
      });
    });

    assert.strictEqual(allowed, true);
    assert.strictEqual(rejected, false);
  });
});
