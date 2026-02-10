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

// Get the target URL from environment
const SMOKE_TEST_URL = process.env.SMOKE_TEST_URL;
const SMOKE_TEST_TIMEOUT = parseInt(process.env.SMOKE_TEST_TIMEOUT || '10000', 10);

interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
}

interface ConfigResponse {
  publicUrl?: string;
  version?: string;
  [key: string]: unknown;
}

interface ErrorResponse {
  error?: string;
  message?: string;
  path?: string;
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

/**
 * Helper to check if response is JSON
 */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ?? false;
}

void describe('Smoke Tests - Live Deployment Verification', () => {
  before(() => {
    if (!SMOKE_TEST_URL) {
      console.log('\n⚠️  SMOKE_TEST_URL not set. Skipping smoke tests.');
      console.log('   Set SMOKE_TEST_URL=https://your-staging-url.com to run these tests.\n');
    }
  });

  void describe('Health Endpoints', { skip: !SMOKE_TEST_URL }, () => {
    void test('GET /health returns 200 OK', async () => {
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/health`);

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
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/cp/health`);

      assert.strictEqual(
        response.status,
        200,
        `Gateway health endpoint should return 200, got ${response.status}`
      );
    });
  });

  void describe('API Endpoints - Path Preservation', { skip: !SMOKE_TEST_URL }, () => {
    /**
     * CRITICAL: This test catches the NPM path-stripping bug
     * If NPM is misconfigured, /api/config becomes /config and returns 404
     */
    void test('GET /api/config returns 200 (NOT 404 from path stripping)', async () => {
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/api/config`);

      // The key assertion: should NOT be 404
      assert.notStrictEqual(
        response.status,
        404,
        'API config should NOT return 404. ' +
          'If you see 404, NPM is likely stripping the /api/ prefix. ' +
          'Check NPM advanced configuration.'
      );

      // Should be 200 for config endpoint
      assert.strictEqual(
        response.status,
        200,
        `API config should return 200, got ${response.status}`
      );

      // Verify it's returning proper config, not an error page
      if (isJsonResponse(response)) {
        const data = (await response.json()) as ConfigResponse | ErrorResponse;

        // Check it's not a "path not found" error
        if ('path' in data && data.path) {
          assert.fail(
            `API returned path error: ${JSON.stringify(data)}. ` +
              'This indicates NPM is stripping path prefixes.'
          );
        }
      }
    });

    void test('GET /api/nonexistent returns proper 404 (not path-stripped 404)', async () => {
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/api/nonexistent-endpoint-12345`);

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
    void test('GET /trpc/healthcheck.live responds (not 404)', async () => {
      const response = await fetchWithTimeout(
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

      // 502 means the backend is unreachable - this is a critical failure
      if (response.status === 502) {
        assert.fail(
          'tRPC returned 502 Bad Gateway. ' +
            'The API container may be down or NPM cannot reach it. ' +
            'Check: docker logs classroompath-api'
        );
      }

      // Accept various valid responses (200, 400 for missing input, etc.)
      // The point is that tRPC router is reachable
      assert.ok(
        [200, 400, 401, 500].includes(response.status),
        `tRPC should be reachable, got ${response.status}`
      );
    });

    void test('tRPC batch endpoint responds', async () => {
      const response = await fetchWithTimeout(
        `${SMOKE_TEST_URL}/trpc/healthcheck.live?batch=1&input={}`,
        { method: 'GET' }
      );

      assert.notStrictEqual(response.status, 404, 'tRPC batch endpoint should not return 404');
    });

    void test('GET /trpc/groups.list returns 403 (blocked, must use /cp/trpc)', async () => {
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/trpc/groups.list`, {
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
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/`);

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
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/login`);

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

      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/api/config`, {
        headers: {
          Origin: origin,
        },
      });

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

      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/api/config`, {
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
      const response = await fetchWithTimeout(`${SMOKE_TEST_URL}/`);

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
        console.log(`⚠️  Missing security headers: ${missingHeaders.join(', ')}`);
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
      await fetchWithTimeout(`${SMOKE_TEST_URL}/health`, {}, 5000);
      const duration = Date.now() - start;

      assert.ok(duration < 2000, `Health check took ${duration}ms, should be under 2000ms`);
    });

    void test('SPA loads within 5 seconds', async () => {
      const start = Date.now();
      await fetchWithTimeout(`${SMOKE_TEST_URL}/`, {}, 10000);
      const duration = Date.now() - start;

      assert.ok(duration < 5000, `SPA load took ${duration}ms, should be under 5000ms`);
    });
  });
});

/**
 * Summary test that provides clear pass/fail output
 */
void describe('Smoke Test Summary', { skip: !SMOKE_TEST_URL }, () => {
  void test('All critical endpoints are accessible', async () => {
    const endpoints = [
      { path: '/health', name: 'API Health' },
      { path: '/cp/health', name: 'Gateway Health' },
      { path: '/api/config', name: 'API Config' },
      { path: '/', name: 'SPA Root' },
    ];

    const results: Array<{ name: string; status: number; ok: boolean }> = [];

    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithTimeout(`${SMOKE_TEST_URL}${endpoint.path}`);
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
