import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { describe, it } from 'node:test';

import {
  mapNotificationActionTrpcError,
  notificationApproveDomainRequestHandler,
} from '../src/lib/notification-actions-route.js';

function createResponse() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('notification action routes', () => {
  it('rejects approval actions without a request id before auth lookup', async () => {
    const response = createResponse();

    await notificationApproveDomainRequestHandler(
      { body: {} } as never,
      response as never,
      (() => undefined) as never
    );

    assert.strictEqual(response.statusCode, 400);
    assert.deepStrictEqual(response.body, {
      error: {
        message: 'requestId is required',
        code: 'BAD_REQUEST',
        data: { code: 'BAD_REQUEST' },
      },
    });
  });

  it('rejects approval actions without an authenticated session', async () => {
    const response = createResponse();

    await notificationApproveDomainRequestHandler(
      { body: { requestId: ' req_123 ' }, headers: {} } as never,
      response as never,
      (() => undefined) as never
    );

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(response.body, {
      error: {
        message: 'Not authenticated',
        code: 'UNAUTHORIZED',
        data: { code: 'UNAUTHORIZED' },
      },
    });
  });

  it('maps tRPC errors to notification action HTTP responses', () => {
    assert.deepStrictEqual(
      mapNotificationActionTrpcError(new TRPCError({ code: 'NOT_FOUND', message: 'Missing' })),
      { status: 404, code: 'NOT_FOUND' }
    );
    assert.deepStrictEqual(
      mapNotificationActionTrpcError(
        new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' })
      ),
      { status: 409, code: 'CONFLICT' }
    );
    assert.deepStrictEqual(
      mapNotificationActionTrpcError(new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid' })),
      { status: 400, code: 'BAD_REQUEST' }
    );
    assert.deepStrictEqual(
      mapNotificationActionTrpcError(
        new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected' })
      ),
      { status: 500, code: 'INTERNAL_SERVER_ERROR' }
    );
  });
});
