import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { extractTrpcData, parseOpenPathPayload } from '../src/lib/openpath/response.js';

describe('openpath response', () => {
  it('unwraps tRPC data and validates payloads', () => {
    assert.deepEqual(extractTrpcData({ result: { data: { ok: true } } }), { ok: true });
    assert.equal(extractTrpcData('nope'), null);
    assert.deepEqual(parseOpenPathPayload({ ok: true }, z.object({ ok: z.boolean() }), 'invalid'), {
      ok: true,
    });
    assert.throws(
      () => parseOpenPathPayload({ ok: 'nope' }, z.object({ ok: z.boolean() }), 'invalid'),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'invalid'
    );
  });
});
