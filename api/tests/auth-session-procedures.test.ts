import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import type { Context } from '../src/trpc/context.js';
import { authRouter } from '../src/trpc/routers/auth.js';
import { authSessionProcedures } from '../src/trpc/routers/auth-session-procedures.js';

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

describe('auth-session-procedures', () => {
  it('exposes the session procedures through the split router module', () => {
    assert.deepStrictEqual(Object.keys(authSessionProcedures).sort(), [
      'changePassword',
      'googleLogin',
      'login',
      'logout',
      'me',
      'refresh',
    ]);
  });

  it('refresh rejects requests without a refresh token in input or cookies', async () => {
    const caller = authRouter.createCaller(
      createContext({
        req: { headers: {} } as never,
      })
    );

    await assert.rejects(caller.refresh(), (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.strictEqual(error.code, 'UNAUTHORIZED');
      assert.match(error.message, /refresh token required/i);
      return true;
    });
  });
});
