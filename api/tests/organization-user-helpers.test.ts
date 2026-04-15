import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAST_ADMIN_CONFLICT_MESSAGE,
  assertManagedOrganizationUser,
  assertOrganizationAdminSurvivability,
  getPersistedUserRole,
  presentOrganizationUserById,
} from '../src/services/organization-user-helpers.js';

void describe('organization-user-helpers', () => {
  void test('exports the helper surface used by user write flows', () => {
    assert.equal(typeof presentOrganizationUserById, 'function');
    assert.equal(typeof getPersistedUserRole, 'function');
    assert.equal(typeof assertManagedOrganizationUser, 'function');
    assert.equal(typeof assertOrganizationAdminSurvivability, 'function');
    assert.match(LAST_ADMIN_CONFLICT_MESSAGE, /last admin/i);
  });
});
