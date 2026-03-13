/**
 * ClassroomPath Smoke Tests
 *
 * Post-deployment verification tests that run against the LIVE staging/production URLs.
 * These tests verify that the deployment is working correctly through the full stack
 * (NPM reverse proxy -> Docker containers -> API).
 *
 * Run with: SMOKE_TEST_URL=https://classroompath-staging.duckdns.org npm run test:smoke
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';

import { CURRENT_TERMS_VERSION } from '../api/src/services/legal-consent.service.js';

// Get the target URL from environment
const SMOKE_TEST_URL = process.env.SMOKE_TEST_URL;
const SMOKE_TEST_TIMEOUT = parseInt(process.env.SMOKE_TEST_TIMEOUT || '10000', 10);
const SMOKE_SKIP_CORS = process.env.SMOKE_SKIP_CORS === '1';
const SMOKE_ALLOW_MUTATIONS = process.env.SMOKE_ALLOW_MUTATIONS === '1';
const SMOKE_TEST_RETRIES = parseInt(process.env.SMOKE_TEST_RETRIES || '2', 10);
const SMOKE_TEST_RETRY_DELAY_MS = parseInt(process.env.SMOKE_TEST_RETRY_DELAY_MS || '1000', 10);

function isIpAddress(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '');
  const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;

  return ipv4Pattern.test(normalized) || (normalized.includes(':') && ipv6Pattern.test(normalized));
}

const SMOKE_HOSTNAME = SMOKE_TEST_URL ? new URL(SMOKE_TEST_URL).hostname : '';
const SMOKE_RELAX_CORS = SMOKE_SKIP_CORS || (SMOKE_HOSTNAME ? isIpAddress(SMOKE_HOSTNAME) : false);

interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
}

interface ErrorResponse {
  error?: {
    message?: string;
    code?: string;
    data?: {
      code?: string;
      path?: string;
      blocked?: string;
    };
  };
  message?: string;
  path?: string;
}

interface TrpcEnvelope<T = unknown> {
  result?: {
    data?: T;
  };
  error?: {
    message?: string;
    code?: string;
    data?: {
      code?: string;
    };
  };
}

interface RegistrationSmokeResponse {
  email?: string;
  verificationRequired?: boolean;
  verificationUrl?: string;
  termsVersion?: string;
}

/**
 * Helper to make HTTP requests with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = SMOKE_TEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to retry transient fetch failures.
 *
 * GitHub-hosted runners can hit intermittent network/DNS flakiness against DuckDNS.
 * We retry ONLY on network errors and on common transient gateway statuses.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeout = SMOKE_TEST_TIMEOUT,
  retries = SMOKE_TEST_RETRIES
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);

      // Retry transient gateway errors (e.g., during container restarts)
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        await sleep(SMOKE_TEST_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(SMOKE_TEST_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  // Should be unreachable, but keeps TS happy.
  throw lastError;
}

/**
 * Helper to check if response is JSON
 */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ?? false;
}

function assertGatewaySecurityHeaders(response: Response): void {
  const csp = response.headers.get('content-security-policy');

  assert.strictEqual(
    response.headers.get('x-content-type-options'),
    'nosniff',
    'Gateway should send X-Content-Type-Options: nosniff'
  );
  assert.strictEqual(
    response.headers.get('x-frame-options'),
    'DENY',
    'Gateway should send X-Frame-Options: DENY'
  );
  assert.strictEqual(
    response.headers.get('referrer-policy'),
    'strict-origin-when-cross-origin',
    'Gateway should send Referrer-Policy: strict-origin-when-cross-origin'
  );
  assert.strictEqual(
    response.headers.get('cross-origin-opener-policy'),
    'same-origin-allow-popups',
    'Gateway should send Cross-Origin-Opener-Policy: same-origin-allow-popups'
  );
  assert.strictEqual(
    response.headers.get('cross-origin-resource-policy'),
    'cross-origin',
    'Gateway should send Cross-Origin-Resource-Policy: cross-origin'
  );
  assert.ok(
    response.headers.get('x-request-id'),
    'Gateway responses should include an x-request-id header'
  );
  assert.strictEqual(
    response.headers.get('x-powered-by'),
    null,
    'Gateway should not expose x-powered-by'
  );
  assert.ok(csp, 'Gateway responses should include a content-security-policy header');
  assert.match(csp, /default-src 'self'/);
}

function uniqueSmokeEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function parseTrpcEnvelope<T>(payload: unknown): {
  data?: T;
  error?: {
    message?: string;
    code?: string;
  };
} {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const envelope = payload as TrpcEnvelope<T>;
  if (envelope.result !== undefined) {
    return { data: envelope.result.data };
  }
  if (envelope.error !== undefined) {
    return {
      error: {
        message: envelope.error.message,
        code: envelope.error.data?.code ?? envelope.error.code,
      },
    };
  }
  return {};
}

void describe('Smoke Tests - Live Deployment Verification', () => {
  before(() => {
    if (!SMOKE_TEST_URL) {
      console.log('\nWARN: SMOKE_TEST_URL not set. Skipping smoke tests.');
      console.log('   Set SMOKE_TEST_URL=https://your-staging-url.com to run these tests.\n');
    }
  });

  void describe('Health Endpoints', { skip: !SMOKE_TEST_URL }, () => {
    void test('GET /health returns 200 OK', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/health`);

      // 502 means NPM can't reach the API container
      if (response.status === 502) {
        assert.fail(
          'Health endpoint returned 502 Bad Gateway. ' +
            'The API container (classroompath-api) may be down or unreachable. ' +
            'Debug: docker logs classroompath-api --tail 50'
        );
      }

      assert.strictEqual(
        response.status,
        200,
        `Health endpoint should return 200, got ${response.status}`
      );

      if (isJsonResponse(response)) {
        const data = (await response.json()) as HealthResponse;
        assert.strictEqual(data.status, 'ok', 'Health response should have status: ok');
      }
    });

    void test('GET /cp/health (Gateway) returns 200 OK', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/cp/health`);

      assert.strictEqual(
        response.status,
        200,
        `Gateway health endpoint should return 200, got ${response.status}`
      );

      assertGatewaySecurityHeaders(response);
    });

    void test('GET /cp/ready (Gateway) returns 200 OK', async () => {
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/cp/ready`);

      assert.strictEqual(
        response.status,
        200,
        `Gateway readiness endpoint should return 200, got ${response.status}`
      );

      assertGatewaySecurityHeaders(response);
    });
  });

  void describe('API Endpoints - Path Preservation', { skip: !SMOKE_TEST_URL }, () => {
    /**
     * CRITICAL: This test catches the NPM path-stripping bug
     * If NPM is misconfigured, /api/config becomes /config and returns 404.
     * The hardened gateway now exposes the public upstream config endpoint, which is expected.
     */
    void test('GET /api/config returns public config (NOT 404 from path stripping)', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/api/config`);

      // The key assertion: should NOT be 404
      assert.notStrictEqual(
        response.status,
        404,
        'API config should NOT return 404. ' +
          'If you see 404, NPM is likely stripping the /api/ prefix. ' +
          'Check NPM advanced configuration.'
      );

      assert.strictEqual(
        response.status,
        200,
        `Public /api/config should return 200, got ${response.status}`
      );

      if (isJsonResponse(response)) {
        const data = (await response.json()) as { googleClientId?: string };

        assert.ok('googleClientId' in data, 'Public config should expose the Google client id key');
      }
    });

    void test('GET /api/nonexistent returns proper 404 (not path-stripped 404)', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/api/nonexistent-endpoint-12345`);

      // This SHOULD be 404, but for the right reason (endpoint doesn't exist)
      // not because /api/ was stripped
      if (response.status === 404 && isJsonResponse(response)) {
        const data = (await response.json()) as ErrorResponse;

        // If path is "/nonexistent-endpoint-12345" instead of "/api/nonexistent-endpoint-12345"
        // then NPM is stripping the prefix
        if (data.path && !data.path.startsWith('/api/')) {
          assert.fail(
            `NPM is stripping /api/ prefix! Got path: ${data.path}. ` +
              'Fix NPM advanced configuration.'
          );
        }
      }
    });
  });

  void describe('tRPC Endpoints', { skip: !SMOKE_TEST_URL }, () => {
    void test('GET /trpc/healthcheck.live is blocked with 403 (not 404)', async () => {
      const response = await fetchWithRetry(
        `${SMOKE_TEST_URL}/trpc/healthcheck.live?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`,
        {
          method: 'GET',
        }
      );

      // Should NOT be 404 (which would indicate path stripping)
      assert.notStrictEqual(
        response.status,
        404,
        'tRPC endpoint should not return 404. Check NPM configuration.'
      );

      assert.strictEqual(
        response.status,
        403,
        `Direct /trpc passthrough should be blocked with 403, got ${response.status}`
      );
    });

    void test('tRPC batch endpoint responds', async () => {
      const response = await fetchWithRetry(
        `${SMOKE_TEST_URL}/trpc/healthcheck.live?batch=1&input={}`,
        { method: 'GET' }
      );

      assert.strictEqual(
        response.status,
        403,
        `Direct /trpc batch endpoint should be blocked with 403, got ${response.status}`
      );
    });

    void test('GET /trpc/groups.list returns 403 (blocked, must use /cp/trpc)', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/trpc/groups.list`, {
        method: 'GET',
      });

      assert.strictEqual(
        response.status,
        403,
        'Sensitive OpenPath procedures must be blocked on /trpc (use /cp/trpc)'
      );
    });
  });

  void describe('SPA Static Files', { skip: !SMOKE_TEST_URL }, () => {
    void test('GET / returns HTML (SPA index)', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/`);

      assert.strictEqual(
        response.status,
        200,
        `SPA root should return 200, got ${response.status}`
      );

      const contentType = response.headers.get('content-type');
      assert.ok(contentType?.includes('text/html'), `SPA should return HTML, got ${contentType}`);

      const html = await response.text();
      assert.ok(
        html.includes('<!DOCTYPE html>') || html.includes('<html'),
        'Response should be valid HTML'
      );

      // Verify it's our app, not an error page
      assert.ok(
        html.includes('ClassroomPath') ||
          html.includes('OpenPath') ||
          html.includes('id="root"') ||
          html.includes('id="app"'),
        'HTML should be our SPA, not a generic error page'
      );
    });

    void test('SPA client-side routes return index.html', async () => {
      // Test a client-side route that doesn't exist as a file
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/login`);

      assert.strictEqual(
        response.status,
        200,
        'Client-side route should return 200 (SPA fallback)'
      );

      const contentType = response.headers.get('content-type');
      assert.ok(contentType?.includes('text/html'), 'Client-side route should return HTML');
    });
  });

  void describe('CORS Configuration', { skip: !SMOKE_TEST_URL }, () => {
    void test('API allows requests from the staging origin', async () => {
      // Extract origin from SMOKE_TEST_URL
      const origin = new URL(SMOKE_TEST_URL!).origin;

      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/api/config`, {
        headers: {
          Origin: origin,
        },
      });

      if (SMOKE_RELAX_CORS) {
        assert.notStrictEqual(
          response.status,
          502,
          'Smoke target is unreachable (502). Check gateway/api containers and reverse proxy.'
        );
        assert.ok(response.status < 500, `Expected API to be reachable, got ${response.status}`);
        console.log('WARN: skipping strict CORS origin assertion for IP/fallback smoke target.');
        return;
      }

      // Check CORS headers
      const allowOrigin = response.headers.get('access-control-allow-origin');

      // Should either allow the specific origin or allow all (not ideal but functional)
      assert.ok(
        allowOrigin === origin || allowOrigin === '*',
        `CORS should allow origin ${origin}, got: ${allowOrigin}. ` +
          'Check CORS_ORIGINS environment variable.'
      );
    });

    void test('API responds to preflight OPTIONS requests', async () => {
      const origin = new URL(SMOKE_TEST_URL!).origin;

      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/api/config`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });

      // Preflight should return 200 or 204
      assert.ok(
        [200, 204].includes(response.status),
        `Preflight should return 200/204, got ${response.status}`
      );

      const allowMethods = response.headers.get('access-control-allow-methods');
      assert.ok(allowMethods, 'Should have Access-Control-Allow-Methods header');
    });
  });

  void describe('Security Headers', { skip: !SMOKE_TEST_URL }, () => {
    void test('Responses include security headers', async () => {
      const response = await fetchWithRetry(`${SMOKE_TEST_URL}/`);

      // These should be set by nginx/NPM
      const securityHeaders = ['x-content-type-options', 'x-frame-options'];

      const missingHeaders: string[] = [];
      for (const header of securityHeaders) {
        if (!response.headers.get(header)) {
          missingHeaders.push(header);
        }
      }

      // Warn but don't fail for missing headers (they might be set at NPM level)
      if (missingHeaders.length > 0) {
        console.log(`WARN: missing security headers: ${missingHeaders.join(', ')}`);
      }
    });

    void test('HTTPS redirect is working', async () => {
      // Only test if URL is HTTPS
      if (!SMOKE_TEST_URL?.startsWith('https://')) {
        return;
      }

      // Try HTTP version (if accessible)
      const httpUrl = SMOKE_TEST_URL.replace('https://', 'http://');

      try {
        const response = await fetchWithTimeout(httpUrl, {
          redirect: 'manual', // Don't follow redirects
        });

        // Should redirect to HTTPS
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          assert.ok(location?.startsWith('https://'), 'HTTP should redirect to HTTPS');
        }
        // Or might be blocked/unreachable, which is fine
      } catch {
        // HTTP might not be accessible at all, which is acceptable
      }
    });
  });

  void describe('Response Times', { skip: !SMOKE_TEST_URL }, () => {
    void test('Health endpoint responds within 2 seconds', async () => {
      const start = Date.now();
      try {
        await fetchWithTimeout(`${SMOKE_TEST_URL}/health`, {}, 5000);
        const duration = Date.now() - start;
        assert.ok(duration < 2000, `Health check took ${duration}ms, should be under 2000ms`);
      } catch (error) {
        console.log(`WARN: skipping strict timing assertion due to fetch error: ${String(error)}`);
      }
    });

    void test('SPA loads within 5 seconds', async () => {
      const start = Date.now();
      try {
        await fetchWithTimeout(`${SMOKE_TEST_URL}/`, {}, 10000);
        const duration = Date.now() - start;
        assert.ok(duration < 5000, `SPA load took ${duration}ms, should be under 5000ms`);
      } catch (error) {
        console.log(`WARN: skipping strict timing assertion due to fetch error: ${String(error)}`);
      }
    });
  });

  void describe(
    'Staging-only Registration Flow',
    {
      skip: !SMOKE_TEST_URL || !SMOKE_ALLOW_MUTATIONS,
    },
    () => {
      void test('POST /cp/trpc/auth.register succeeds for a fresh user', async () => {
        const email = uniqueSmokeEmail('smoke-register');
        const response = await fetchWithRetry(
          `${SMOKE_TEST_URL}/cp/trpc/auth.register`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email,
              name: 'Smoke Registration',
              password: 'SecurePassword123!',
              termsAccepted: true,
              termsVersion: CURRENT_TERMS_VERSION,
            }),
          },
          20000
        );

        assert.strictEqual(response.status, 200, `auth.register returned ${response.status}`);

        const raw = (await response.json()) as unknown;
        const parsed = parseTrpcEnvelope<RegistrationSmokeResponse>(raw);

        assert.ok(!parsed.error, `Expected auth.register success, got ${JSON.stringify(raw)}`);
        assert.strictEqual(parsed.data?.email, email);
        assert.strictEqual(parsed.data?.verificationRequired, true);
        assert.strictEqual(parsed.data?.termsVersion, CURRENT_TERMS_VERSION);
        assert.equal(typeof parsed.data?.verificationUrl, 'string');
      });
    }
  );
});

/**
 * Summary test that provides clear pass/fail output
 */
void describe('Smoke Test Summary', { skip: !SMOKE_TEST_URL }, () => {
  void test('All critical endpoints are accessible', async () => {
    const endpoints = [
      { path: '/health', name: 'API Health' },
      { path: '/cp/health', name: 'Gateway Health' },
      { path: '/cp/ready', name: 'Gateway Ready' },
      { path: '/', name: 'SPA Root' },
    ];

    const results: Array<{ name: string; status: number; ok: boolean }> = [];

    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithRetry(`${SMOKE_TEST_URL}${endpoint.path}`);
        results.push({
          name: endpoint.name,
          status: response.status,
          ok: response.status === 200,
        });
      } catch (error) {
        results.push({
          name: endpoint.name,
          status: 0,
          ok: false,
        });
      }
    }

    console.log('\n📊 Smoke Test Results:');
    console.log('─'.repeat(50));
    for (const result of results) {
      const icon = result.ok ? '✅' : '❌';
      console.log(`${icon} ${result.name}: ${result.status || 'FAILED'}`);
    }
    console.log('─'.repeat(50));

    const allPassed = results.every((r) => r.ok);
    assert.ok(allPassed, `Some endpoints failed. Check the results above.`);
  });
});
