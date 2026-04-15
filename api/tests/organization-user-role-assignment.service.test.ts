import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assignOrganizationUserRole } from '../src/services/organization-user-role-assignment.service.js';

void describe('organization-user-role-assignment.service', () => {
  void test('exports the organization user role assignment use-case', () => {
    assert.equal(typeof assignOrganizationUserRole, 'function');
  });
});
