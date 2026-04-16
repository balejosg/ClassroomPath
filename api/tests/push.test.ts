import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pushRouter } from '../src/trpc/routers/push.js';
import type { Context } from '../src/trpc/context.js';

function createContext(): Context {
  return {
    user: null,
    token: null,
    req: { headers: {} } as never,
    res: {} as never,
    authFailure: null,
  };
}

describe('pushRouter', () => {
  it('exposes the public VAPID key status without requiring authentication', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_CONTACT;

    const result = await pushRouter.createCaller(createContext()).getVapidPublicKey();

    assert.deepStrictEqual(result, {
      publicKey: '',
      enabled: false,
    });
  });
});
