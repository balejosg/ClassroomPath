import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  EMPTY_RULE_COUNTS,
  presentTemplate,
  presentTemplateRule,
  presentTenantGroupLookup,
  presentTenantGroupMutation,
  presentTenantGroupSummary,
  presentUserRole,
  presentUserWithRoles,
} from '../src/services/presenters.js';

describe('presenters', () => {
  it('presents tenant group summaries with boolean enabled and counts', () => {
    const group = {
      id: 'group_1',
      name: 'opaque-name',
      displayName: 'Visible Group',
      enabled: 1,
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-02T10:00:00.000Z'),
    } as any;

    const presented = presentTenantGroupSummary({
      group,
      publicName: 'visible-group',
      visibility: 'instance_public',
      counts: {
        whitelistCount: 2,
        blockedSubdomainCount: 1,
        blockedPathCount: 3,
      },
    });

    assert.strictEqual(presented.name, 'visible-group');
    assert.strictEqual(presented.enabled, true);
    assert.strictEqual(presented.visibility, 'instance_public');
    assert.strictEqual(presented.whitelistCount, 2);
    assert.strictEqual(presented.blockedSubdomainCount, 1);
    assert.strictEqual(presented.blockedPathCount, 3);
    assert.strictEqual(presented.createdAt, '2026-03-01T10:00:00.000Z');
    assert.strictEqual(presented.updatedAt, '2026-03-02T10:00:00.000Z');
  });

  it('uses safe defaults for empty group counts and lookup payloads', () => {
    const group = {
      id: 'group_2',
      name: 'opaque-name-2',
      displayName: 'Lookup Group',
      enabled: 0,
      createdAt: null,
      updatedAt: null,
    } as any;

    const summary = presentTenantGroupSummary({ group });
    const lookup = presentTenantGroupLookup({ group, publicName: 'lookup-group' });
    const mutation = presentTenantGroupMutation({ group, publicName: 'lookup-group' });

    assert.deepStrictEqual(
      {
        whitelistCount: summary.whitelistCount,
        blockedSubdomainCount: summary.blockedSubdomainCount,
        blockedPathCount: summary.blockedPathCount,
      },
      EMPTY_RULE_COUNTS
    );
    assert.strictEqual(lookup.enabled, 0);
    assert.strictEqual(mutation.enabled, false);
  });

  it('presents tenant users and role fallbacks', () => {
    const user = {
      id: 'user_1',
      email: 'teacher@example.com',
      name: 'Teacher User',
      isActive: true,
      emailVerified: false,
      createdAt: null,
      updatedAt: null,
    } as any;

    const presentedUser = presentUserWithRoles({
      user,
      roles: [{ role: 'teacher', groupIds: ['group_1'] }],
      nowIso: '2026-03-03T12:00:00.000Z',
    });

    const presentedRole = presentUserRole({
      role: null,
      fallback: {
        userId: 'user_1',
        role: 'teacher',
        groupIds: ['group_1'],
        createdBy: 'admin_1',
      },
    });

    assert.strictEqual(presentedUser.createdAt, '2026-03-03T12:00:00.000Z');
    assert.strictEqual(presentedUser.updatedAt, '2026-03-03T12:00:00.000Z');
    assert.deepStrictEqual(presentedUser.roles, [{ role: 'teacher', groupIds: ['group_1'] }]);
    assert.strictEqual(presentedRole.userId, 'user_1');
    assert.strictEqual(presentedRole.role, 'teacher');
    assert.deepStrictEqual(presentedRole.groupIds, ['group_1']);
    assert.strictEqual(presentedRole.createdBy, 'admin_1');
    assert.strictEqual(presentedRole.createdAt, null);
  });

  it('presents templates and template rules with ISO dates', () => {
    const template = {
      id: 'tpl_1',
      name: 'template-one',
      displayName: 'Template One',
      description: 'Example',
      createdBy: 'admin_1',
      createdAt: new Date('2026-03-04T09:00:00.000Z'),
      updatedAt: new Date('2026-03-05T09:00:00.000Z'),
    } as any;
    const rule = {
      id: 'tpl_rule_1',
      templateId: 'tpl_1',
      type: 'whitelist',
      value: 'example.com',
      comment: 'Visible',
      createdAt: new Date('2026-03-06T09:00:00.000Z'),
    } as any;

    const presentedTemplate = presentTemplate(template, 4);
    const presentedRule = presentTemplateRule(rule);

    assert.strictEqual(presentedTemplate.ruleCount, 4);
    assert.strictEqual(presentedTemplate.createdAt, '2026-03-04T09:00:00.000Z');
    assert.strictEqual(presentedTemplate.updatedAt, '2026-03-05T09:00:00.000Z');
    assert.strictEqual(presentedRule.createdAt, '2026-03-06T09:00:00.000Z');
  });
});
