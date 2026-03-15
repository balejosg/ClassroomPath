import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TRPCError } from '@trpc/server';

import type { Context } from '../src/trpc/context.js';
import { authRouter } from '../src/trpc/routers/auth.js';

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    user: null,
    token: null,
    req: { headers: {} } as never,
    res: {} as never,
    authFailure: null,
    ...overrides,
  };
}

async function expectTrpcError(
  promise: Promise<unknown>,
  expectedCode: TRPCError['code'],
  expectedMessage: RegExp
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TRPCError);
    assert.strictEqual(error.code, expectedCode);
    assert.match(error.message, expectedMessage);
    return true;
  });
}

describe('authRouter', () => {
  test('exposes the expected auth procedures', () => {
    const caller = authRouter.createCaller(createContext());

    assert.strictEqual(typeof caller.login, 'function');
    assert.strictEqual(typeof caller.googleLogin, 'function');
    assert.strictEqual(typeof caller.googleSignup, 'function');
    assert.strictEqual(typeof caller.me, 'function');
    assert.strictEqual(typeof caller.logout, 'function');
    assert.strictEqual(typeof caller.register, 'function');
    assert.strictEqual(typeof caller.generateEmailVerificationToken, 'function');
    assert.strictEqual(typeof caller.verifyEmail, 'function');
    assert.strictEqual(typeof caller.getInvitation, 'function');
    assert.strictEqual(typeof caller.acceptInvitation, 'function');
    assert.strictEqual(typeof caller.generateResetToken, 'function');
    assert.strictEqual(typeof caller.resetPassword, 'function');
  });

  test('me rejects unauthenticated callers', async () => {
    const caller = authRouter.createCaller(createContext());

    await expectTrpcError(caller.me(), 'UNAUTHORIZED', /not authenticated/i);
  });
});
