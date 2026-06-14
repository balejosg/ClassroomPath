import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  applyGatewaySecurityHeaders,
  buildGatewayContentSecurityPolicy,
  createGatewayCorsOriginResolver,
  createGatewayCsrfProtectionMiddleware,
} from '../src/lib/gateway-headers.js';

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;

  return {
    headers,
    statusCode,
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

function makeReq(
  overrides: {
    method?: string;
    url?: string;
    headers?: Record<string, string | undefined>;
    protocol?: string;
    socket?: { remoteAddress?: string };
  } = {}
) {
  return {
    method: overrides.method ?? 'GET',
    originalUrl: overrides.url ?? '/test',
    url: overrides.url ?? '/test',
    protocol: overrides.protocol ?? 'http',
    headers: overrides.headers ?? {},
    socket: overrides.socket ?? { remoteAddress: '127.0.0.1' },
    requestId: 'test-req-id',
    get(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    },
  };
}

await describe('buildGatewayContentSecurityPolicy', async () => {
  await test('includes localhost and ws origins outside production', () => {
    const policy = buildGatewayContentSecurityPolicy('development');

    assert.match(policy, /connect-src/);
    assert.match(policy, /http:\/\/localhost:\*/);
    assert.match(policy, /http:\/\/127\.0\.0\.1:\*/);
    assert.match(policy, /ws:\/\/localhost:\*/);
  });

  await test('includes localhost and ws origins in test env', () => {
    const policy = buildGatewayContentSecurityPolicy('test');

    assert.match(policy, /http:\/\/localhost:\*/);
    assert.match(policy, /ws:\/\/localhost:\*/);
  });

  await test('excludes localhost and ws origins in production', () => {
    const policy = buildGatewayContentSecurityPolicy('production');

    assert.doesNotMatch(policy, /localhost/);
    assert.doesNotMatch(policy, /ws:\/\//);
  });

  await test('always includes google accounts in connect-src', () => {
    const prod = buildGatewayContentSecurityPolicy('production');
    const dev = buildGatewayContentSecurityPolicy('development');

    assert.match(prod, /connect-src[^;]*accounts\.google\.com/);
    assert.match(dev, /connect-src[^;]*accounts\.google\.com/);
  });

  await test('always includes unsafe-inline in style-src', () => {
    const policy = buildGatewayContentSecurityPolicy('production');

    assert.match(policy, /style-src[^;]*'unsafe-inline'/);
  });

  await test('always includes frame-ancestors none', () => {
    const policy = buildGatewayContentSecurityPolicy('production');

    assert.match(policy, /frame-ancestors 'none'/);
  });

  await test('uses process.env.NODE_ENV when no argument given', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const policy = buildGatewayContentSecurityPolicy();
      assert.doesNotMatch(policy, /localhost/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

await describe('applyGatewaySecurityHeaders', async () => {
  await test('sets all expected security headers and calls next', () => {
    const res = makeRes();
    let nextCalled = false;

    applyGatewaySecurityHeaders(makeReq() as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.ok(res.headers['content-security-policy'], 'CSP header missing');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.strictEqual(res.headers['x-dns-prefetch-control'], 'off');
    assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin-allow-popups');
    assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.strictEqual(
      res.headers['permissions-policy'],
      'camera=(), microphone=(), geolocation=()'
    );
  });
});

await describe('createGatewayCorsOriginResolver', async () => {
  await test('allows an origin in the configured list', async () => {
    const resolver = createGatewayCorsOriginResolver(['https://classroompath.test']);

    const result = await new Promise<boolean>((resolve, reject) => {
      resolver('https://classroompath.test', (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });

    assert.strictEqual(result, true);
  });

  await test('rejects an origin not in the list', async () => {
    const resolver = createGatewayCorsOriginResolver(['https://classroompath.test']);

    const result = await new Promise<boolean>((resolve, reject) => {
      resolver('https://evil.test', (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });

    assert.strictEqual(result, false);
  });

  await test('allows requests with no origin header (same-origin / non-browser)', async () => {
    const resolver = createGatewayCorsOriginResolver(['https://classroompath.test']);

    const result = await new Promise<boolean>((resolve, reject) => {
      resolver(undefined, (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });

    assert.strictEqual(result, true);
  });

  await test('handles multiple allowed origins independently', async () => {
    const resolver = createGatewayCorsOriginResolver(['https://a.example', 'https://b.example']);

    const aAllowed = await new Promise<boolean>((resolve, reject) => {
      resolver('https://a.example', (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });
    const bAllowed = await new Promise<boolean>((resolve, reject) => {
      resolver('https://b.example', (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });
    const cRejected = await new Promise<boolean>((resolve, reject) => {
      resolver('https://c.example', (err, allow) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(allow ?? false);
      });
    });

    assert.strictEqual(aAllowed, true);
    assert.strictEqual(bAllowed, true);
    assert.strictEqual(cRejected, false);
  });
});

await describe('createGatewayCsrfProtectionMiddleware', async () => {
  const params = {
    allowedOrigins: ['https://classroompath.test'],
    publicOrigin: 'https://classroompath.test',
  };
  const middleware = createGatewayCsrfProtectionMiddleware(params);

  await test('passes through GET requests without checking origin (not a mutation)', () => {
    const req = makeReq({ method: 'GET', headers: { origin: 'https://evil.test' } });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCodeValue, 200);
  });

  await test('passes through POST with a Bearer token (not cookie-authenticated)', () => {
    const req = makeReq({
      method: 'POST',
      headers: {
        authorization: 'Bearer some-jwt-token',
        origin: 'https://evil.test',
      },
    });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
  });

  await test('allows POST with matching origin and session cookie', () => {
    const req = makeReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        origin: 'https://classroompath.test',
        cookie: 'cp_access_token=abc123',
        host: 'classroompath.test',
      },
    });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
  });

  await test('rejects POST with mismatched origin and session cookie', () => {
    const req = makeReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        origin: 'https://evil.test',
        cookie: 'cp_access_token=abc123',
        host: 'classroompath.test',
      },
    });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCodeValue, 403);
    const body = res.jsonBody as { error: { code: string } };
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  await test('allows DELETE when refresh cookie is present and origin matches', () => {
    const req = makeReq({
      method: 'DELETE',
      protocol: 'https',
      headers: {
        origin: 'https://classroompath.test',
        cookie: 'cp_refresh_token=ref456',
        host: 'classroompath.test',
      },
    });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
  });

  await test('rejects mutation with no origin header and session cookie', () => {
    // No origin and no referer means candidateOrigin is null → blocked
    const req = makeReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'cp_access_token=abc123',
        host: 'classroompath.test',
      },
    });
    const res = makeRes();
    let nextCalled = false;

    middleware(req as never, res as never, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCodeValue, 403);
  });
});
