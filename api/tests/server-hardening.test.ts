import assert from 'node:assert';
import type { Server } from 'node:http';
import { after, afterEach, before, describe, test } from 'node:test';

import { getAvailablePort, waitForHealth } from './test-utils.js';

const REQUEST_ID = 'req-hardening-test-123';
const LARGE_TARGET_ORG_ID = 'x'.repeat(70_000);
const TEST_NODE_ENV = 'test';
const TEST_JWT_SECRET = 'test-jwt-secret';
const TEST_PLATFORM_ADMIN_EMAIL = 'platform-admin@classroompath.test';
const TEST_STRIPE_SECRET_KEY = 'sk_test_server_hardening';
const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_server_hardening';
const TEST_STRIPE_PRICE_ID = 'price_server_hardening';
const TEST_PUBLIC_URL = 'http://localhost:5173';

let server: Server | undefined;
let baseUrl = '';
let app: (typeof import('../src/server.js'))['app'];
let serverModule: typeof import('../src/server.js');

function applyBillingRuntimeEnv(): void {
  process.env.CP_PLATFORM_ADMIN_EMAILS = TEST_PLATFORM_ADMIN_EMAIL;
  process.env.STRIPE_SECRET_KEY = TEST_STRIPE_SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_ANNUAL_PRICE_1_10 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_ANNUAL_PRICE_11_25 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_ANNUAL_PRICE_26_50 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_ANNUAL_PRICE_51_100 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_ONBOARDING_PRICE_1_25 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_ONBOARDING_PRICE_26_100 = TEST_STRIPE_PRICE_ID;
  process.env.STRIPE_PILOT_PRICE = TEST_STRIPE_PRICE_ID;
}

function requestHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

function captureStdout<T>(run: () => Promise<T>): Promise<{ result: T; output: string }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = '';

  process.stdout.write = ((chunk, encoding, callback) => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : chunk.toString(typeof encoding === 'string' ? encoding : 'utf8');
    output += text;

    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }

    return true;
  }) as typeof process.stdout.write;

  return run()
    .then(async (result) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { result, output };
    })
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

afterEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.NODE_ENV = TEST_NODE_ENV;
  process.env.PUBLIC_URL = TEST_PUBLIC_URL;
  process.env.CORS_ORIGINS = TEST_PUBLIC_URL;
  applyBillingRuntimeEnv();
});

await describe('gateway server hardening', { concurrency: false }, async () => {
  before(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = TEST_NODE_ENV;
    process.env.PUBLIC_URL = TEST_PUBLIC_URL;
    process.env.CORS_ORIGINS = TEST_PUBLIC_URL;
    applyBillingRuntimeEnv();

    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;
    serverModule = (await import('../src/server.js')) as typeof import('../src/server.js');
    app = serverModule.createGatewayApp({
      enableRateLimit: true,
      globalRateLimitMax: 3,
      globalRateLimitWindowMs: 60_000,
      jsonBodyLimit: '1kb',
      authRateLimitWindowMs: 60_000,
      authRateLimitMax: 5,
      onboardingRateLimitWindowMs: 60_000,
      onboardingRateLimitMax: 5,
    });
    server = app.listen(port);
    await waitForHealth(baseUrl);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  test('adds security headers, removes x-powered-by, and logs the request id', async () => {
    const { result: response, output } = await captureStdout(
      async () =>
        await fetch(`${baseUrl}/cp/health`, {
          headers: requestHeaders({
            'X-Request-Id': REQUEST_ID,
          }),
        })
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(response.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.strictEqual(
      response.headers.get('cross-origin-opener-policy'),
      'same-origin-allow-popups'
    );
    assert.strictEqual(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.strictEqual(response.headers.get('x-request-id'), REQUEST_ID);
    assert.strictEqual(response.headers.get('x-powered-by'), null);
    assert.match(output, /HTTP request completed/i);
    assert.match(output, new RegExp(REQUEST_ID));
  });

  test('rejects oversized JSON bodies before reaching onboarding handlers', async () => {
    const response = await fetch(`${baseUrl}/cp/trpc/onboarding.waitForInvitation`, {
      method: 'POST',
      headers: requestHeaders({
        'X-Forwarded-For': '198.51.100.21',
      }),
      body: JSON.stringify({
        targetOrganizationId: LARGE_TARGET_ORG_ID,
      }),
    });

    assert.strictEqual(response.status, 413);
    assert.ok(response.headers.get('x-request-id'));
    assert.match(response.headers.get('content-type') ?? '', /application\/json/i);

    const body = (await response.json()) as {
      error?: { message?: string; code?: string };
    };
    assert.strictEqual(body.error?.code, 'PAYLOAD_TOO_LARGE');
    assert.match(body.error?.message ?? '', /payload too large/i);
  });

  test('rate limits abuse-prone onboarding endpoints by caller IP', async () => {
    const path = `${baseUrl}/cp/trpc/onboarding.waitForInvitation`;
    const headers = requestHeaders({
      'X-Forwarded-For': '198.51.100.99',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      assert.notStrictEqual(
        response.status,
        429,
        `attempt ${String(attempt + 1)} should not be rate-limited`
      );
    }

    const limitedResponse = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    assert.strictEqual(limitedResponse.status, 429);
    assert.ok(limitedResponse.headers.get('retry-after'));
    assert.ok(limitedResponse.headers.get('x-request-id'));

    const body = (await limitedResponse.json()) as {
      error?: { message?: string; code?: string; data?: { requestId?: string } };
    };

    assert.strictEqual(body.error?.code, 'TOO_MANY_REQUESTS');
    assert.match(body.error?.message ?? '', /too many requests/i);
    assert.ok(body.error?.data?.requestId);
  });

  test('rate limits generic traffic with the global bucket', async () => {
    const path = `${baseUrl}/cp/trpc/users.list`;
    const headers = requestHeaders({
      'X-Forwarded-For': '198.51.100.55',
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      assert.notStrictEqual(response.status, 429);
    }

    const limitedResponse = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    assert.strictEqual(limitedResponse.status, 429);
  });

  test('rate limits repeated auth attempts by caller IP', async () => {
    const path = `${baseUrl}/cp/trpc/auth.login`;
    const headers = requestHeaders({
      'X-Forwarded-For': '198.51.100.77',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'rate-limit@test.local',
          password: 'password123',
        }),
      });

      assert.notStrictEqual(
        response.status,
        429,
        `attempt ${String(attempt + 1)} should not be rate-limited`
      );
    }

    const limitedResponse = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'rate-limit@test.local',
        password: 'password123',
      }),
    });

    assert.strictEqual(limitedResponse.status, 429);
    assert.ok(limitedResponse.headers.get('retry-after'));
    assert.ok(limitedResponse.headers.get('x-request-id'));

    const body = (await limitedResponse.json()) as {
      error?: { message?: string; code?: string; data?: { requestId?: string } };
    };

    assert.strictEqual(body.error?.code, 'TOO_MANY_REQUESTS');
    assert.match(body.error?.message ?? '', /too many requests/i);
    assert.ok(body.error?.data?.requestId);
  });

  test('createGatewayApp fails fast when JWT_SECRET is missing outside test mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.CORS_ORIGINS = 'https://classroompath.test';
    applyBillingRuntimeEnv();
    delete process.env.JWT_SECRET;

    assert.throws(() => serverModule.createGatewayApp(), /JWT_SECRET/i);
  });

  test('createGatewayApp fails fast when CORS_ORIGINS is missing outside test mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://classroompath.test';
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    applyBillingRuntimeEnv();
    delete process.env.CORS_ORIGINS;

    assert.throws(() => serverModule.createGatewayApp(), /CORS_ORIGINS/i);
  });

  test('rejects cookie-authenticated mutation requests without a trusted origin', async () => {
    const response = await fetch(`${baseUrl}/cp/trpc/auth.logout`, {
      method: 'POST',
      headers: {
        Cookie: 'cp_access_token=fake-access; cp_refresh_token=fake-refresh',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(response.status, 403);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    assert.strictEqual(body.error?.code, 'FORBIDDEN');
    assert.match(body.error?.message ?? '', /csrf origin/i);
  });

  test('allows trusted-origin cookie mutations to continue past CSRF checks', async () => {
    const response = await fetch(`${baseUrl}/cp/trpc/auth.logout`, {
      method: 'POST',
      headers: {
        Cookie: 'cp_access_token=fake-access; cp_refresh_token=fake-refresh',
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    assert.notStrictEqual(response.status, 403);
  });

  test('createGatewayApp can skip SPA mounting for API-focused test servers', async () => {
    const port = await getAvailablePort();
    const localBaseUrl = `http://127.0.0.1:${String(port)}`;
    const apiOnlyApp = serverModule.createGatewayApp({
      serveSpa: false,
    });
    const apiOnlyServer = apiOnlyApp.listen(port);

    try {
      await waitForHealth(localBaseUrl);

      const response = await fetch(`${localBaseUrl}/classrooms`);

      assert.strictEqual(response.status, 404);
      assert.match(response.headers.get('content-type') ?? '', /html|json/i);
      assert.match(await response.text(), /not found|cannot get/i);
    } finally {
      await new Promise<void>((resolve, reject) => {
        apiOnlyServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
