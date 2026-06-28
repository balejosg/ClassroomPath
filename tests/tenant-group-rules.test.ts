import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTenantGroupRules,
  type TenantGroupRulesDependencies,
} from '../api/src/services/tenant-group-rules.service.js';

type Call = { name: string; payload: unknown };

function createHarness(overrides: Partial<TenantGroupRulesDependencies> = {}) {
  const calls: Call[] = [];

  const deps: TenantGroupRulesDependencies = {
    assertCanUseGroup: async (ctx, groupId, options) => {
      calls.push({ name: 'assertCanUseGroup', payload: { ctx, groupId, options } });
    },
    publishWhitelistGroupChanged: async (groupId) => {
      calls.push({ name: 'publishWhitelistGroupChanged', payload: groupId });
    },
    createOrReuseGroupRule: async (input) => {
      calls.push({ name: 'createOrReuseGroupRule', payload: input });
      return {
        id: 'rule-1',
        groupId: input.groupId,
        type: input.type,
        value: input.value,
        comment: input.comment ?? null,
        createdAt: null,
        created: true,
      };
    },
    bulkCreateGroupRules: async (input) => {
      calls.push({ name: 'bulkCreateGroupRules', payload: input });
      return input.values.length;
    },
    deleteGroupRule: async (input) => {
      calls.push({ name: 'deleteGroupRule', payload: input });
      return true;
    },
    updateGroupRule: async (input) => {
      calls.push({ name: 'updateGroupRule', payload: input });
      return {
        valueChanged: true,
        rule: {
          id: input.id,
          groupId: input.groupId,
          type: 'whitelist',
          value: input.value ?? 'example.org',
          comment: input.comment ?? null,
          createdAt: null,
        },
      };
    },
    ...overrides,
  };

  return {
    calls,
    service: createTenantGroupRules(deps),
  };
}

const ctx = {
  organizationId: 'org-1',
  userRole: 'teacher',
  user: { sub: 'user-1', name: 'Teacher One' },
};

describe('TenantGroupRules', () => {
  test('createRule owns tenant authorization, OpenPath write, and conditional publication', async () => {
    const { calls, service } = createHarness();

    const result = await service.createRule(ctx, {
      groupId: 'group-1',
      type: 'whitelist',
      value: 'example.org',
      comment: 'Allowed for class',
    });

    assert.equal(result.created, true);
    assert.deepEqual(
      calls.map((call) => call.name),
      ['assertCanUseGroup', 'createOrReuseGroupRule', 'publishWhitelistGroupChanged']
    );
    assert.deepEqual(calls[0]?.payload, {
      ctx,
      groupId: 'group-1',
      options: { notAllowedMessage: 'Insufficient permissions for this group' },
    });
    assert.equal(calls[2]?.payload, 'group-1');
  });

  test('createRule skips publication when the OpenPath rule already exists', async () => {
    const { calls, service } = createHarness({
      createOrReuseGroupRule: async (input) => {
        calls.push({ name: 'createOrReuseGroupRule', payload: input });
        return {
          id: 'rule-existing',
          groupId: input.groupId,
          type: input.type,
          value: input.value,
          comment: null,
          source: 'manual',
          createdAt: null,
          created: false,
        };
      },
    });

    await service.createRule(ctx, {
      groupId: 'group-1',
      type: 'whitelist',
      value: 'example.org',
    });

    assert.deepEqual(
      calls.map((call) => call.name),
      ['assertCanUseGroup', 'createOrReuseGroupRule']
    );
  });

  test('bulkCreateRules returns the existing router count shape and publishes only when rows are inserted', async () => {
    const { calls, service } = createHarness({ bulkCreateGroupRules: async () => 0 });

    const result = await service.bulkCreateRules(ctx, {
      groupId: 'group-1',
      type: 'blocked_subdomain',
      values: ['ads.example.org'],
    });

    assert.deepEqual(result, { count: 0 });
    assert.deepEqual(
      calls.map((call) => call.name),
      ['assertCanUseGroup']
    );
  });

  test('updateRule returns the serialized rule and publishes only when value changes', async () => {
    const { calls, service } = createHarness({
      updateGroupRule: async (input) => {
        calls.push({ name: 'updateGroupRule', payload: input });
        return {
          valueChanged: false,
          rule: {
            id: input.id,
            groupId: input.groupId,
            type: 'whitelist',
            value: 'example.org',
            comment: input.comment ?? null,
            source: 'manual',
            createdAt: null,
          },
        };
      },
    });

    const rule = await service.updateRule(ctx, {
      id: 'rule-1',
      groupId: 'group-1',
      comment: 'Comment only',
    });

    assert.equal(rule.id, 'rule-1');
    assert.deepEqual(
      calls.map((call) => call.name),
      ['assertCanUseGroup', 'updateGroupRule']
    );
  });

  test('deleteRule preserves the router success shape and publishes deleted groups', async () => {
    const { calls, service } = createHarness();

    const result = await service.deleteRule(ctx, { id: 'rule-1', groupId: 'group-1' });

    assert.deepEqual(result, { success: true });
    assert.deepEqual(
      calls.map((call) => call.name),
      ['assertCanUseGroup', 'deleteGroupRule', 'publishWhitelistGroupChanged']
    );
  });
});
