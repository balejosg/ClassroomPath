import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { revokeOrganizationUserRole } from '../src/services/organization-user-role-revoke.service.js';

void describe('organization-user-role-revoke.service', () => {
  void test('exports the organization user role revocation use-case', () => {
    assert.equal(typeof revokeOrganizationUserRole, 'function');
  });
});
