import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildOrganizationMutationOperation,
  getOrganizationMutationRetryHandler,
  getOrganizationMutationWorkflowFamily,
  organizationMutationCatalog,
  organizationMutationOperationTypes,
} from '../src/lib/organization-mutation-workflow/index.js';
import type { OrganizationBusinessMutation } from '../src/lib/organization-mutation-workflow/index.js';

void describe('organization-mutation-workflow module', () => {
  const mutations: OrganizationBusinessMutation[] = [
    {
      kind: 'onboardingCreateOrganization',
      name: 'Recon Org',
      userId: 'admin_1',
    },
    {
      kind: 'pendingUserApproval',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'teacher',
      approvedBy: 'admin_1',
    },
    {
      kind: 'userAssignRole',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      groupIds: ['group_b', 'group_a'],
      actedBy: 'admin_1',
    },
    {
      kind: 'userRevokeRole',
      organizationId: 'org_1',
      userId: 'user_1',
      actedBy: 'admin_1',
    },
    {
      kind: 'userDelete',
      organizationId: 'org_1',
      userId: 'user_1',
      actedBy: 'admin_1',
    },
    {
      kind: 'groupCreate',
      organizationId: 'org_1',
      actorUserId: 'admin_1',
      actorRole: 'admin',
      publicName: 'group-public',
      displayName: 'Group Public',
      enabled: 1,
      visibility: 'private',
      rules: [{ type: 'domain', value: 'example.com', comment: null }],
    },
    {
      kind: 'groupDelete',
      organizationId: 'org_1',
      userId: 'admin_1',
      userRole: 'admin',
      groupId: 'group_1',
    },
    {
      kind: 'classroomCreate',
      organizationId: 'org_1',
      userId: 'admin_1',
      publicName: 'maths',
      displayName: 'Maths',
      defaultGroupId: null,
    },
    {
      kind: 'classroomDelete',
      organizationId: 'org_1',
      userId: 'admin_1',
      classroomId: 'classroom_1',
    },
  ];

  void test('exposes stable operation types and facts from the module entrypoint', () => {
    assert.deepEqual(
      mutations.map((mutation) => buildOrganizationMutationOperation(mutation).operationType),
      organizationMutationOperationTypes
    );
    assert.deepEqual(
      mutations.map((mutation) => buildOrganizationMutationOperation(mutation).idempotencyKey),
      [
        'admin_1',
        'org_1:user_1',
        'org_1:user_1:admin:group_a,group_b',
        'org_1:user_1',
        'org_1:user_1',
        'org_1:group-public',
        'org_1:group_1',
        'org_1:maths',
        'org_1:classroom_1',
      ]
    );
  });

  void test('keeps every business mutation kind mapped to exactly one operation type', () => {
    const operationTypes = mutations.map(
      (mutation) => buildOrganizationMutationOperation(mutation).operationType
    );

    assert.equal(new Set(operationTypes).size, mutations.length);
    assert.deepEqual([...operationTypes].sort(), [...organizationMutationOperationTypes].sort());
    assert.deepEqual(Object.keys(organizationMutationCatalog).sort(), [...operationTypes].sort());
  });

  void test('resolves workflow families and retry handlers through separate module surfaces', () => {
    assert.equal(
      getOrganizationMutationWorkflowFamily('pending_users.approve_user'),
      'local-first'
    );
    assert.equal(getOrganizationMutationWorkflowFamily('groups.create_group'), 'upstream-first');
    assert.equal(getOrganizationMutationWorkflowFamily('classrooms.delete_classroom'), 'delete');
    assert.equal(getOrganizationMutationWorkflowFamily('unsupported.operation'), undefined);

    assert.equal(getOrganizationMutationRetryHandler('onboarding.create_organization'), undefined);
    assert.equal(typeof getOrganizationMutationRetryHandler('users.assign_role'), 'function');
    assert.equal(typeof getOrganizationMutationRetryHandler('groups.delete_group'), 'function');
    assert.equal(
      typeof getOrganizationMutationRetryHandler('classrooms.create_classroom'),
      'function'
    );
    assert.equal(getOrganizationMutationRetryHandler('unsupported.operation'), undefined);
  });

  void test('keeps the pure catalog free of service imports', async () => {
    const catalogSource = await readFile(
      new URL('../src/lib/organization-mutation-workflow/catalog.ts', import.meta.url),
      'utf8'
    );

    assert.doesNotMatch(catalogSource, /\.\.\/services\//);
    assert.doesNotMatch(catalogSource, /from ['"].*services\//);
    assert.doesNotMatch(catalogSource, /from ['"].*retry-adapters\.js['"]/);
  });
});
