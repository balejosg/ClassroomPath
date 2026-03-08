import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  REQUEST_ID_HEADER,
  assignRequestId,
  getRequestId,
  getRequestIdFromHeaders,
} from '../src/lib/request-id.js';

await describe('request-id helpers', async () => {
  await test('reuses a valid incoming request id header', () => {
    const requestId = getRequestIdFromHeaders({
      'x-request-id': 'req-incoming-123',
    });

    assert.strictEqual(requestId, 'req-incoming-123');
  });

  await test('generates a request id when the incoming header is missing or invalid', () => {
    const generated = getRequestIdFromHeaders({});
    const invalidGenerated = getRequestIdFromHeaders({
      'x-request-id': 'invalid id with spaces',
    });

    assert.match(generated, /^[A-Za-z0-9_-]{10,}$/);
    assert.match(invalidGenerated, /^[A-Za-z0-9_-]{10,}$/);
    assert.notStrictEqual(generated, invalidGenerated);
  });

  await test('assignRequestId stores the id on the request and response', () => {
    const headers: Record<string, string> = {
      'x-request-id': 'req-middleware-123',
    };
    const responseHeaders = new Map<string, string>();
    let nextCalls = 0;

    assignRequestId(
      {
        headers,
      } as never,
      {
        setHeader: (name: string, value: string) => {
          responseHeaders.set(name, value);
        },
      } as never,
      () => {
        nextCalls += 1;
      }
    );

    assert.strictEqual(headers['x-request-id'], 'req-middleware-123');
    assert.strictEqual(responseHeaders.get(REQUEST_ID_HEADER), 'req-middleware-123');
    assert.strictEqual(nextCalls, 1);
  });

  await test('getRequest prefers req.requestId and falls back to headers', () => {
    assert.strictEqual(
      getRequestId({
        requestId: 'req-from-request',
        headers: {},
      } as never),
      'req-from-request'
    );

    assert.strictEqual(
      getRequestId({
        headers: { 'x-request-id': 'req-from-header' },
      } as never),
      'req-from-header'
    );
  });
});
