import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authSessionProcedures } from '../src/trpc/routers/auth-session-procedures.js';

describe('auth-session-procedures', () => {
  it('exposes the session procedures through the split router module', () => {
    assert.deepStrictEqual(Object.keys(authSessionProcedures).sort(), [
      'googleLogin',
      'login',
      'logout',
      'me',
    ]);
  });
});
