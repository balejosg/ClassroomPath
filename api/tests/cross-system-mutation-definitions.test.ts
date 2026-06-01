import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrganizationMutationOperation,
  getOrganizationMutationWorkflowFamily,
} from '../src/lib/cross-system-mutation-definitions.js';

void describe('cross-system-mutation-definitions', () => {
  void test('builds operation facts for local-first, upstream-first, and delete families', () => {
    assert.deepEqual(
      buildOrganizationMutationOperation({
        kind: 'pendingUserApproval',
        organizationId: 'org_1',
        userId: 'user_1',
        role: 'teacher',
        approvedBy: 'admin_1',
      }),
      {
        family: 'local-first',
        operationType: 'pending_users.approve_user',
        idempotencyKey: 'org_1:user_1',
        organizationId: 'org_1',
        userId: 'user_1',
        metadata: { role: 'teacher', approvedBy: 'admin_1' },
      }
    );

    assert.deepEqual(
      buildOrganizationMutationOperation({
        kind: 'classroomCreate',
        organizationId: 'org_1',
        userId: 'admin_1',
        publicName: 'maths',
        displayName: 'Maths',
        defaultGroupId: null,
      }),
      {
        family: 'upstream-first',
        operationType: 'classrooms.create_classroom',
        idempotencyKey: 'org_1:maths',
        organizationId: 'org_1',
        userId: 'admin_1',
        metadata: {
          captivePortalDomains: [],
          defaultGroupId: null,
          displayName: 'Maths',
          publicName: 'maths',
        },
      }
    );

    assert.deepEqual(
      buildOrganizationMutationOperation({
        kind: 'groupDelete',
        organizationId: 'org_1',
        userId: 'admin_1',
        userRole: 'admin',
        groupId: 'group_1',
      }),
      {
        family: 'delete',
        operationType: 'groups.delete_group',
        idempotencyKey: 'org_1:group_1',
        organizationId: 'org_1',
        userId: 'admin_1',
        metadata: { groupId: 'group_1', userRole: 'admin' },
      }
    );
  });

  void test('reports supported workflow families and fails closed for unknown operations', () => {
    assert.equal(
      getOrganizationMutationWorkflowFamily('pending_users.approve_user'),
      'local-first'
    );
    assert.equal(getOrganizationMutationWorkflowFamily('groups.create_group'), 'upstream-first');
    assert.equal(getOrganizationMutationWorkflowFamily('classrooms.delete_classroom'), 'delete');
    assert.equal(getOrganizationMutationWorkflowFamily('unsupported.operation'), undefined);
  });
});
