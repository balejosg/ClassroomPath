import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrganizationMutationOperation,
  getOrganizationMutationRetryHandler,
  getOrganizationMutationWorkflowFamily,
  organizationMutationCatalog,
  organizationMutationOperationTypes,
  organizationMutationRetryHandlers,
  type OrganizationBusinessMutation,
} from '../src/lib/organization-mutation-catalog.js';

void describe('organization-mutation-catalog', () => {
  const sampleMutations: OrganizationBusinessMutation[] = [
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
      defaultGroupId: 'group_1',
    },
    {
      kind: 'classroomDelete',
      organizationId: 'org_1',
      userId: 'admin_1',
      classroomId: 'classroom_1',
    },
  ];

  void test('catalogues every supported operation type once', () => {
    assert.deepEqual(
      [...organizationMutationOperationTypes].sort(),
      Object.keys(organizationMutationCatalog).sort()
    );
    assert.deepEqual(
      sampleMutations.map((mutation) => buildOrganizationMutationOperation(mutation).operationType),
      organizationMutationOperationTypes
    );
  });

  void test('keeps every retry handler attached to a catalogued operation', () => {
    for (const operationType of Object.keys(organizationMutationRetryHandlers)) {
      assert.ok(
        Object.hasOwn(organizationMutationCatalog, operationType),
        `${operationType} retry handler must belong to the catalog`
      );
      assert.equal(typeof getOrganizationMutationRetryHandler(operationType), 'function');
    }

    assert.equal(getOrganizationMutationRetryHandler('unsupported.operation'), undefined);
    assert.equal(getOrganizationMutationRetryHandler('onboarding.create_organization'), undefined);
  });

  void test('keeps workflow families and metadata builders together', () => {
    for (const mutation of sampleMutations) {
      const operation = buildOrganizationMutationOperation(mutation);
      assert.equal(
        getOrganizationMutationWorkflowFamily(operation.operationType),
        operation.family
      );
    }

    assert.deepEqual(buildOrganizationMutationOperation(sampleMutations[1]!).metadata, {
      approvedBy: 'admin_1',
      role: 'teacher',
    });
    assert.deepEqual(buildOrganizationMutationOperation(sampleMutations[5]!).metadata, {
      actorRole: 'admin',
      displayName: 'Group Public',
      enabled: 1,
      publicName: 'group-public',
      rules: [{ type: 'domain', value: 'example.com', comment: null }],
      visibility: 'private',
    });
    assert.deepEqual(buildOrganizationMutationOperation(sampleMutations[7]!).metadata, {
      captivePortalDomains: [],
      defaultGroupId: 'group_1',
      displayName: 'Maths',
      publicName: 'maths',
    });
  });

  void test('fails closed for unsupported operation types', () => {
    assert.equal(getOrganizationMutationWorkflowFamily('unsupported.operation'), undefined);
    assert.equal(getOrganizationMutationRetryHandler('unsupported.operation'), undefined);
  });
});
