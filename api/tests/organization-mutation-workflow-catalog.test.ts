import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrganizationMutationOperation,
  getOrganizationMutationWorkflowFamily,
  organizationMutationCatalog,
  organizationMutationOperationTypes,
} from '../src/lib/organization-mutation-workflow/catalog.js';

void describe('organization-mutation-workflow/catalog', () => {
  void test('builds catalog facts without retry handlers', () => {
    const facts = buildOrganizationMutationOperation({
      kind: 'userAssignRole',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      groupIds: ['group_b', 'group_a'],
      actedBy: 'admin_1',
    });

    assert.equal(facts.operationType, 'users.assign_role');
    assert.equal(facts.idempotencyKey, 'org_1:user_1:admin:group_a,group_b');
    assert.equal(getOrganizationMutationWorkflowFamily(facts.operationType), 'local-first');
    assert.equal(
      organizationMutationOperationTypes.length,
      Object.keys(organizationMutationCatalog).length
    );
    assert.equal('retry' in organizationMutationCatalog['users.assign_role'], false);
  });
});
