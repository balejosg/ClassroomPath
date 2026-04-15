import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import { callOpenPathTrpc, openPathTrpcUrl } from '../src/lib/openpath/trpc-client.js';

describe('openpath trpc client', () => {
  it('builds canonical URLs and unwraps successful upstream payloads', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test///';
    assert.equal(openPathTrpcUrl('auth.login'), 'http://example.test/trpc/auth.login');

    const result = await callOpenPathTrpc({
      procedure: 'auth.login',
      input: { email: 'ada@example.com' },
      defaultErrorCode: 'BAD_REQUEST',
      upstreamFailureMessage: 'login failed',
      unavailableMessage: 'auth unavailable',
      fetchImpl: async () =>
        new Response(JSON.stringify({ result: { data: { ok: true } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    assert.deepEqual(result, { ok: true });
  });

  it('maps upstream failures into TRPC errors', async () => {
    await assert.rejects(
      () =>
        callOpenPathTrpc({
          procedure: 'auth.login',
          defaultErrorCode: 'BAD_REQUEST',
          upstreamFailureMessage: 'login failed',
          unavailableMessage: 'auth unavailable',
          fetchImpl: async () =>
            new Response(JSON.stringify({ error: { message: 'forbidden' } }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            }),
        }),
      (error: unknown) =>
        error instanceof TRPCError && error.code === 'FORBIDDEN' && error.message === 'forbidden'
    );
  });
});
