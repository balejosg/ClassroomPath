import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTenantGroupRules,
  type TenantGroupRulesDependencies,
} from '../src/services/tenant-group-rules.service.js';

describe('tenant-group-rules.service', () => {
  test('coordinates authorization, OpenPath mutation, and publication for created rules', async () => {
    const calls: string[] = [];
    const dependencies: TenantGroupRulesDependencies = {
      assertCanUseGroup: async (_ctx, groupId, options) => {
        calls.push(`assert:${groupId}:${options.notAllowedMessage}`);
      },
      publishWhitelistGroupChanged: async (groupId) => {
        calls.push(`publish:${groupId}`);
      },
      createOrReuseGroupRule: async (input) => {
        calls.push(`create:${input.groupId}:${input.value}`);
        return {
          id: 'rule-1',
          groupId: input.groupId,
          type: input.type,
          value: input.value,
          comment: input.comment ?? null,
          source: 'manual',
          createdAt: null,
          created: true,
        };
      },
      bulkCreateGroupRules: async () => 0,
      deleteGroupRule: async () => false,
      updateGroupRule: async () => {
        throw new Error('not used');
      },
      revokeAutoApprovalRule: async () => {
        throw new Error('not used');
      },
    };

    const service = createTenantGroupRules(dependencies);

    const result = await service.createRule(
      {
        organizationId: 'org-1',
        userRole: 'teacher',
        user: { sub: 'user-1', name: 'Teacher One' },
      },
      {
        groupId: 'group-1',
        type: 'whitelist',
        value: 'example.org',
      }
    );

    assert.equal(result.created, true);
    assert.deepEqual(calls, [
      'assert:group-1:Insufficient permissions for this group',
      'create:group-1:example.org',
      'publish:group-1',
    ]);
  });
});
