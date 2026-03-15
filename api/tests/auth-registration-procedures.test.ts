import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authRegistrationProcedures } from '../src/trpc/routers/auth-registration-procedures.js';

describe('auth-registration-procedures', () => {
  it('exposes the self-service registration procedures through the split router module', () => {
    assert.deepStrictEqual(Object.keys(authRegistrationProcedures).sort(), [
      'generateEmailVerificationToken',
      'googleSignup',
      'register',
      'verifyEmail',
    ]);
  });
});
