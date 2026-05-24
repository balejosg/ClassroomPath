import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { organizationMutationRetryAdapters } from '../../../src/lib/organization-mutation-workflow/retry-adapters.js';

void describe('organization-mutation-workflow/retry-adapters', () => {
  void test('keeps concrete retry adapters outside the pure catalog', () => {
    assert.deepEqual(Object.keys(organizationMutationRetryAdapters).sort(), [
      'classrooms.create_classroom',
      'classrooms.delete_classroom',
      'groups.create_group',
      'groups.delete_group',
      'pending_users.approve_user',
      'users.assign_role',
      'users.delete_organization_user',
      'users.revoke_role',
    ]);
  });
});
