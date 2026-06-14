import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  createGatewayErrorBody,
  createGatewayErrorMiddleware,
  isPayloadTooLargeError,
} from '../src/lib/gateway-errors.js';

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

function makeRes(opts: { headersSent?: boolean } = {}) {
  let statusCode = 200;
  let body: unknown;

  return {
    headersSent: opts.headersSent ?? false,
    get statusCodeValue() {
      return statusCode;
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

await describe('createGatewayErrorBody', async () => {
  await test('returns the documented shape for TOO_MANY_REQUESTS', () => {
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

  await test('returns the documented shape for FORBIDDEN with no extra data', () => {
    const body = createGatewayErrorBody('FORBIDDEN', 'Invalid CSRF origin');

    assert.deepStrictEqual(body, {
      error: {
        message: 'Invalid CSRF origin',
        code: 'FORBIDDEN',
        data: {
          code: 'FORBIDDEN',
        },
      },
    });
  });

  await test('returns the documented shape for INTERNAL_SERVER_ERROR', () => {
    const body = createGatewayErrorBody('INTERNAL_SERVER_ERROR', 'Internal server error', {
      requestId: 'req-456',
    });

    assert.deepStrictEqual(body, {
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          requestId: 'req-456',
        },
      },
    });
  });

  await test('returns the documented shape for BAD_REQUEST', () => {
    const body = createGatewayErrorBody('BAD_REQUEST', 'Bad request');

    assert.strictEqual(body.error.code, 'BAD_REQUEST');
    assert.strictEqual(body.error.data.code, 'BAD_REQUEST');
    assert.strictEqual(body.error.message, 'Bad request');
  });

  await test('returns the documented shape for PAYLOAD_TOO_LARGE', () => {
    const body = createGatewayErrorBody('PAYLOAD_TOO_LARGE', 'Payload too large');

    assert.strictEqual(body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.strictEqual(body.error.data.code, 'PAYLOAD_TOO_LARGE');
  });

  await test('code is duplicated in both top-level error and nested data', () => {
    const codes = [
      'BAD_REQUEST',
      'FORBIDDEN',
      'INTERNAL_SERVER_ERROR',
      'PAYLOAD_TOO_LARGE',
      'TOO_MANY_REQUESTS',
    ] as const;

    for (const code of codes) {
      const body = createGatewayErrorBody(code, 'msg');
      assert.strictEqual(body.error.code, code, `top-level code mismatch for ${code}`);
      assert.strictEqual(body.error.data.code, code, `nested data.code mismatch for ${code}`);
    }
  });

  await test('extra data fields are merged into data alongside code', () => {
    const body = createGatewayErrorBody('TOO_MANY_REQUESTS', 'msg', {
      bucket: 'auth',
      retryAfterMs: 5000,
    });

    assert.strictEqual(body.error.data.bucket, 'auth');
    assert.strictEqual(body.error.data.retryAfterMs, 5000);
    assert.strictEqual(body.error.data.code, 'TOO_MANY_REQUESTS');
  });
});

await describe('isPayloadTooLargeError', async () => {
  await test('returns true for an object with status 413', () => {
    assert.strictEqual(isPayloadTooLargeError({ status: 413 }), true);
  });

  await test('returns true for an object with statusCode 413', () => {
    assert.strictEqual(isPayloadTooLargeError({ statusCode: 413 }), true);
  });

  await test('returns true for an object with type entity.too.large', () => {
    assert.strictEqual(isPayloadTooLargeError({ type: 'entity.too.large' }), true);
  });

  await test('returns false for status 400', () => {
    assert.strictEqual(isPayloadTooLargeError({ status: 400 }), false);
  });

  await test('returns false for statusCode 400', () => {
    assert.strictEqual(isPayloadTooLargeError({ statusCode: 400 }), false);
  });

  await test('returns false for null', () => {
    assert.strictEqual(isPayloadTooLargeError(null), false);
  });

  await test('returns false for a plain string', () => {
    assert.strictEqual(isPayloadTooLargeError('entity.too.large'), false);
  });

  await test('returns false for a number', () => {
    assert.strictEqual(isPayloadTooLargeError(413), false);
  });

  await test('returns false for undefined', () => {
    assert.strictEqual(isPayloadTooLargeError(undefined), false);
  });

  await test('returns false for an empty object', () => {
    assert.strictEqual(isPayloadTooLargeError({}), false);
  });
});

await describe('createGatewayErrorMiddleware', async () => {
  await test('responds 500 with INTERNAL_SERVER_ERROR body for unhandled errors', () => {
    const middleware = createGatewayErrorMiddleware();
    const req = makeReq();
    const res = makeRes();
    let nextError: unknown;

    middleware(new Error('boom'), req as never, res as never, (err) => {
      nextError = err;
    });

    assert.strictEqual(res.statusCodeValue, 500);
    assert.strictEqual(nextError, undefined);
    const body = res.jsonBody as { error: { code: string; message: string } };
    assert.strictEqual(body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.strictEqual(body.error.message, 'Internal server error');
  });

  await test('passes the error to next() if headers are already sent', () => {
    const middleware = createGatewayErrorMiddleware();
    const req = makeReq();
    const res = makeRes({ headersSent: true });
    const originalError = new Error('already sent');
    let nextError: unknown;

    middleware(originalError, req as never, res as never, (err) => {
      nextError = err;
    });

    // Should not attempt to write a response
    assert.strictEqual(res.jsonBody, undefined);
    assert.strictEqual(nextError, originalError);
  });

  await test('passes payload-too-large errors to next() for body-parser to handle', () => {
    const middleware = createGatewayErrorMiddleware();
    const req = makeReq();
    const res = makeRes();
    const payloadError = { status: 413, type: 'entity.too.large', message: 'too large' };
    let nextError: unknown;

    middleware(payloadError, req as never, res as never, (err) => {
      nextError = err;
    });

    assert.strictEqual(res.jsonBody, undefined);
    assert.strictEqual(nextError, payloadError);
  });

  await test('passes statusCode-413 payload errors through to next()', () => {
    const middleware = createGatewayErrorMiddleware();
    const req = makeReq();
    const res = makeRes();
    const payloadError = { statusCode: 413 };
    let nextError: unknown;

    middleware(payloadError, req as never, res as never, (err) => {
      nextError = err;
    });

    assert.strictEqual(res.jsonBody, undefined);
    assert.strictEqual(nextError, payloadError);
  });

  await test('error body data contains the requestId', () => {
    const middleware = createGatewayErrorMiddleware();
    const req = makeReq({ headers: { 'x-request-id': 'test-abc' } });
    const res = makeRes();

    middleware(new Error('some error'), req as never, res as never, () => {});

    const body = res.jsonBody as { error: { data: { requestId: string } } };
    assert.ok(body.error.data.requestId, 'requestId should be present in error body data');
  });
});
