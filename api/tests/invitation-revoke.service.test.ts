import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { revokeOrganizationInvitation } from '../src/services/invitation-revoke.service.js';

void describe('invitation-revoke.service', () => {
  void test('exports the invitation revoke use-case', () => {
    assert.equal(typeof revokeOrganizationInvitation, 'function');
  });
});
