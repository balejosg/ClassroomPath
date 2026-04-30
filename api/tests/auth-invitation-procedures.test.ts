import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authInvitationProcedures } from '../src/trpc/routers/auth-invitation-procedures.js';

describe('auth-invitation-procedures', () => {
  it('exposes the invitation acceptance procedures through the split router module', () => {
    assert.deepStrictEqual(Object.keys(authInvitationProcedures).sort(), [
      'acceptInvitation',
      'acceptPendingInvitation',
      'getInvitation',
    ]);
  });
});
