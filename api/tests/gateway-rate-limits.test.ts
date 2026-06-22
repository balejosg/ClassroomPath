import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  createGatewayRateLimitRules,
  createRateLimitMiddleware,
} from '../src/lib/gateway-rate-limits.js';

const BASE_OPTIONS = {
  authRateLimitMax: 5,
  authRateLimitWindowMs: 60_000,
  agentDeliveryRateLimitMax: 500,
  agentDeliveryRateLimitWindowMs: 60_000,
  globalRateLimitMax: 50,
  globalRateLimitWindowMs: 60_000,
  onboardingRateLimitMax: 5,
  onboardingRateLimitWindowMs: 60_000,
};

function makeReq(
  overrides: {
    url?: string;
    headers?: Record<string, string | undefined>;
    socket?: { remoteAddress?: string };
  } = {}
) {
  return {
    method: 'GET',
    originalUrl: overrides.url ?? '/test',
    url: overrides.url ?? '/test',
    headers: overrides.headers ?? {},
    socket: overrides.socket ?? { remoteAddress: '127.0.0.1' },
    requestId: 'test-req-id',
    get(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    },
  };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;

  return {
    headers,
    get statusCodeValue() {
      return statusCode;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    get jsonBody() {
      return body;
    },
  };
}

await describe('createGatewayRateLimitRules', async () => {
  await test('returns four rules covering auth, onboarding, agentDelivery, and global buckets', () => {
    const rules = createGatewayRateLimitRules(BASE_OPTIONS);

    assert.strictEqual(rules.length, 4);
    const buckets = rules.map((r) => r.bucket).sort();
    assert.deepStrictEqual(buckets, ['agentDelivery', 'auth', 'global', 'onboarding']);
  });

  await test('propagates options into the correct rule limits and windows', () => {
    const rules = createGatewayRateLimitRules({
      authRateLimitMax: 10,
      authRateLimitWindowMs: 30_000,
      agentDeliveryRateLimitMax: 200,
      agentDeliveryRateLimitWindowMs: 120_000,
      globalRateLimitMax: 100,
      globalRateLimitWindowMs: 90_000,
      onboardingRateLimitMax: 3,
      onboardingRateLimitWindowMs: 45_000,
    });

    const auth = rules.find((r) => r.bucket === 'auth');
    const agent = rules.find((r) => r.bucket === 'agentDelivery');
    const global = rules.find((r) => r.bucket === 'global');
    const onboarding = rules.find((r) => r.bucket === 'onboarding');

    assert.strictEqual(auth?.limit, 10);
    assert.strictEqual(auth?.windowMs, 30_000);
    assert.strictEqual(agent?.limit, 200);
    assert.strictEqual(agent?.windowMs, 120_000);
    assert.strictEqual(global?.limit, 100);
    assert.strictEqual(global?.windowMs, 90_000);
    assert.strictEqual(onboarding?.limit, 3);
    assert.strictEqual(onboarding?.windowMs, 45_000);
  });

  await test('auth rule matches login, googleSignup, changePassword, and resetPassword', () => {
    const rules = createGatewayRateLimitRules(BASE_OPTIONS);
    const auth = rules.find((r) => r.bucket === 'auth');

    assert.ok(auth);
    assert.strictEqual(auth.matches('/cp/trpc/auth.login'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.register'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.googleLogin'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.googleSignup'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.resetPassword'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.changePassword'), true);
    assert.strictEqual(auth.matches('/cp/trpc/auth.logout'), true);
    // without cp prefix
    assert.strictEqual(auth.matches('/trpc/auth.resetPassword?batch=1'), true);
    // should not match onboarding
    assert.strictEqual(auth.matches('/cp/trpc/onboarding.waitForInvitation'), false);
    // should not match partial names
    assert.strictEqual(auth.matches('/cp/trpc/auth.loginExtra'), false);
  });

  await test('onboarding rule matches onboarding procedures only', () => {
    const rules = createGatewayRateLimitRules(BASE_OPTIONS);
    const onboarding = rules.find((r) => r.bucket === 'onboarding');

    assert.ok(onboarding);
    assert.strictEqual(onboarding.matches('/cp/trpc/onboarding.createOrganization'), true);
    assert.strictEqual(onboarding.matches('/cp/trpc/onboarding.waitForInvitation'), true);
    assert.strictEqual(onboarding.matches('/cp/trpc/onboarding.cancelWaiting'), true);
    assert.strictEqual(onboarding.matches('/cp/trpc/auth.login'), false);
  });

  await test('agentDelivery rule matches windows and linux agent paths', () => {
    const rules = createGatewayRateLimitRules(BASE_OPTIONS);
    const agent = rules.find((r) => r.bucket === 'agentDelivery');

    assert.ok(agent);
    assert.strictEqual(agent.matches('/api/agent/windows/latest.json'), true);
    assert.strictEqual(agent.matches('/api/agent/linux/latest.json'), true);
    assert.strictEqual(agent.matches('/api/agent/windows/bootstrap/latest.json'), true);
    assert.strictEqual(
      agent.matches('/api/agent/windows/bootstrap/file?path=runtime%2Fbrowser-policy-spec.json'),
      true
    );
    assert.strictEqual(agent.matches('/api/agent/windows/file?path=OpenPath.ps1'), true);
    // non-agent paths should not match
    assert.strictEqual(agent.matches('/api/agent/windows'), true); // bare path with no suffix still matches (regex anchors on end-of-string too)
    assert.strictEqual(agent.matches('/api/agent/other/latest.json'), false);
    assert.strictEqual(agent.matches('/cp/trpc/auth.login'), false);
  });

  await test('global rule matches general paths and excludes health and agent delivery paths', () => {
    const rules = createGatewayRateLimitRules(BASE_OPTIONS);
    const global = rules.find((r) => r.bucket === 'global');

    assert.ok(global);
    assert.strictEqual(global.matches('/cp/trpc/users.list'), true);
    assert.strictEqual(global.matches('/cp/trpc/auth.login'), true);
    // health and ready paths are excluded
    assert.strictEqual(global.matches('/cp/health'), false);
    assert.strictEqual(global.matches('/cp/ready'), false);
    // agent delivery paths are excluded from global
    assert.strictEqual(global.matches('/api/agent/windows/latest.json'), false);
    assert.strictEqual(global.matches('/api/agent/linux/latest.json'), false);
  });
});

await describe('createRateLimitMiddleware', async () => {
  await test('calls next and sets rate-limit headers when under the limit', () => {
    const rules = createGatewayRateLimitRules({
      ...BASE_OPTIONS,
      authRateLimitMax: 10,
    });
    const middleware = createRateLimitMiddleware(rules);
    const req = makeReq({ url: '/cp/trpc/auth.login' });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.ok(res.headers['x-ratelimit-limit'], 'X-RateLimit-Limit header missing');
    assert.ok(res.headers['x-ratelimit-remaining'], 'X-RateLimit-Remaining header missing');
    assert.ok(res.headers['x-ratelimit-reset'], 'X-RateLimit-Reset header missing');
    assert.strictEqual(res.headers['x-ratelimit-limit'], '10');
    assert.strictEqual(res.headers['x-ratelimit-remaining'], '9');
  });

  await test('returns 429 and sets Retry-After once the limit is exhausted', () => {
    const rules = createGatewayRateLimitRules({
      ...BASE_OPTIONS,
      authRateLimitMax: 2,
      authRateLimitWindowMs: 60_000,
    });
    const middleware = createRateLimitMiddleware(rules);

    // Exhaust the limit — each call uses a fresh req so the IP key is stable
    for (let i = 0; i < 2; i++) {
      const req = makeReq({ url: '/cp/trpc/auth.login' });
      const res = makeRes();
      middleware(req as never, res as never, () => {});
    }

    // This third call should be rate-limited
    const req = makeReq({ url: '/cp/trpc/auth.login' });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCodeValue, 429);
    assert.ok(res.headers['retry-after'], 'Retry-After header missing');
    const body = res.jsonBody as { error: { code: string } };
    assert.strictEqual(body.error.code, 'TOO_MANY_REQUESTS');
  });

  await test('calls next for paths that match no rule', () => {
    // Health check paths are excluded from all rules (they don't match global either)
    // We test with a path that genuinely matches no rule by using an empty rules list
    const middleware = createRateLimitMiddleware([]);
    const req = makeReq({ url: '/cp/trpc/auth.login' });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCodeValue, 200);
  });

  await test('tracks different client IPs independently', () => {
    const rules = createGatewayRateLimitRules({
      ...BASE_OPTIONS,
      authRateLimitMax: 1,
    });
    const middleware = createRateLimitMiddleware(rules);

    // Exhaust limit for IP A
    const reqA = makeReq({
      url: '/cp/trpc/auth.login',
      headers: { 'x-forwarded-for': '192.0.2.1' },
    });
    middleware(reqA as never, makeRes() as never, () => {});

    // IP A should now be limited
    const resA = makeRes();
    let nextCalledA = false;
    middleware(
      makeReq({ url: '/cp/trpc/auth.login', headers: { 'x-forwarded-for': '192.0.2.1' } }) as never,
      resA as never,
      () => {
        nextCalledA = true;
      }
    );
    assert.strictEqual(nextCalledA, false);
    assert.strictEqual(resA.statusCodeValue, 429);

    // IP B should still be allowed
    const resB = makeRes();
    let nextCalledB = false;
    middleware(
      makeReq({ url: '/cp/trpc/auth.login', headers: { 'x-forwarded-for': '192.0.2.2' } }) as never,
      resB as never,
      () => {
        nextCalledB = true;
      }
    );
    assert.strictEqual(nextCalledB, true);
    assert.strictEqual(resB.statusCodeValue, 200);
  });
});
