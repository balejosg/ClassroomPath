import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assignOrganizationUserRoleWorkflow } from '../src/services/organization-user-role-assignment-workflow.service.js';

void describe('organization-user-role-assignment-workflow.service', () => {
  void test('exports the role-assignment workflow use-case', () => {
    assert.equal(typeof assignOrganizationUserRoleWorkflow, 'function');
  });
});
