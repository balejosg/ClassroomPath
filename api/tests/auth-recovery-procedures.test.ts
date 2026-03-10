import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authRecoveryProcedures } from '../src/trpc/routers/auth-recovery-procedures.js';

describe('auth-recovery-procedures', () => {
  it('exposes the reset-token procedures through the split router module', () => {
    assert.deepStrictEqual(Object.keys(authRecoveryProcedures).sort(), [
      'generateResetToken',
      'resetPassword',
    ]);
  });
});
