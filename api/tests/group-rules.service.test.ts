import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import { inArray } from 'drizzle-orm';

import { openpathDb, whitelistGroups, whitelistRules } from '../src/db/openpath.js';
import {
  bulkCreateGroupRules,
  createOrReuseGroupRule,
  deleteGroupRule,
  listGroupedGroupRules,
  listGroupRules,
  listPaginatedGroupRules,
  revokeAutoApprovalRule,
  updateGroupRule,
} from '../src/services/group-rules.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const createdGroupIds = new Set<string>();
let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedGroup(label: string): Promise<string> {
  const groupId = nextId('grp');
  createdGroupIds.add(groupId);

  await openpathDb.insert(whitelistGroups).values({
    id: groupId,
    name: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${RUN_ID}-${counter}`.slice(0, 100),
    displayName: label,
    enabled: 1,
  });

  return groupId;
}

async function seedRule(params: {
  groupId: string;
  type: 'whitelist' | 'blocked_subdomain' | 'blocked_path';
  value: string;
  comment?: string | null;
  source?: 'manual' | 'auto_extension';
}): Promise<string> {
  const ruleId = nextId('rule');
  await openpathDb.insert(whitelistRules).values({
    id: ruleId,
    groupId: params.groupId,
    type: params.type,
    value: params.value,
    comment: params.comment ?? null,
    source: params.source ?? 'manual',
  });
  return ruleId;
}

after(async () => {
  const groupIds = [...createdGroupIds];
  if (groupIds.length === 0) {
    return;
  }

  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.groupId, groupIds));
  await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, groupIds));
});

describe('group-rules.service', () => {
  it('creates a rule once and reuses it on duplicate inserts', async () => {
    const groupId = await seedGroup('Create Or Reuse Group');

    const created = await createOrReuseGroupRule({
      groupId,
      type: 'whitelist',
      value: 'example.com',
      comment: 'first',
    });
    const duplicate = await createOrReuseGroupRule({
      groupId,
      type: 'whitelist',
      value: 'example.com',
      comment: 'ignored',
    });

    assert.strictEqual(created.created, true);
    assert.strictEqual(duplicate.created, false);
    assert.strictEqual(duplicate.id, created.id);
    assert.strictEqual(duplicate.comment, 'first');
  });

  it('lists rules and applies the optional type filter', async () => {
    const groupId = await seedGroup('List Rules Group');
    await seedRule({ groupId, type: 'whitelist', value: 'alpha.test' });
    await seedRule({ groupId, type: 'blocked_subdomain', value: 'beta.test' });

    const allRules = await listGroupRules({ groupId });
    const whitelistOnly = await listGroupRules({ groupId, type: 'whitelist' });
    const manualOnly = await listGroupRules({ groupId, source: 'manual' });

    assert.strictEqual(allRules.length, 2);
    assert.strictEqual(whitelistOnly.length, 1);
    assert.strictEqual(whitelistOnly[0]?.type, 'whitelist');
    assert.strictEqual(manualOnly.length, 2);
    assert.strictEqual(
      allRules.every((rule) => rule.source === 'manual'),
      true
    );
  });

  it('filters rules by automatic approval source', async () => {
    const groupId = await seedGroup('List Auto Approval Rules Group');
    await seedRule({ groupId, type: 'whitelist', value: 'manual.test' });
    await seedRule({
      groupId,
      type: 'whitelist',
      value: 'auto.test',
      source: 'auto_extension',
    });

    const automaticRules = await listGroupRules({ groupId, source: 'auto_extension' });
    const paginatedAutomaticRules = await listPaginatedGroupRules({
      groupId,
      source: 'auto_extension',
      limit: 10,
      offset: 0,
    });

    assert.strictEqual(automaticRules.length, 1);
    assert.strictEqual(automaticRules[0]?.value, 'auto.test');
    assert.strictEqual(automaticRules[0]?.source, 'auto_extension');
    assert.strictEqual(paginatedAutomaticRules.total, 1);
    assert.strictEqual(paginatedAutomaticRules.rules[0]?.value, 'auto.test');
  });

  it('filters paginated rules by search across value and comment', async () => {
    const groupId = await seedGroup('Paginated Rules Group');
    await seedRule({
      groupId,
      type: 'whitelist',
      value: 'alpha.test',
      comment: 'match by comment',
    });
    await seedRule({ groupId, type: 'whitelist', value: 'match-value.test' });
    await seedRule({ groupId, type: 'whitelist', value: 'other.test' });

    const result = await listPaginatedGroupRules({
      groupId,
      limit: 1,
      offset: 0,
      search: 'match',
    });

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.hasMore, true);
  });

  it('groups rules by root domain and derives group status', async () => {
    const groupId = await seedGroup('Grouped Rules Group');
    await seedRule({ groupId, type: 'whitelist', value: 'example.com' });
    await seedRule({ groupId, type: 'blocked_subdomain', value: 'sub.example.com' });
    await seedRule({ groupId, type: 'blocked_path', value: 'docs.school.edu' });
    await seedRule({ groupId, type: 'whitelist', value: 'allowed.org' });

    const result = await listGroupedGroupRules({ groupId, limit: 10, offset: 0 });
    const statusByRoot = new Map(result.groups.map((group) => [group.root, group.status]));

    assert.strictEqual(result.totalGroups, 3);
    assert.strictEqual(result.totalRules, 4);
    assert.strictEqual(result.hasMore, false);
    assert.strictEqual(statusByRoot.get('allowed.org'), 'allowed');
    assert.strictEqual(statusByRoot.get('example.com'), 'mixed');
    assert.strictEqual(statusByRoot.get('school.edu'), 'blocked');
  });

  it('bulk creates rules while skipping duplicates', async () => {
    const groupId = await seedGroup('Bulk Create Group');
    await seedRule({ groupId, type: 'whitelist', value: 'duplicate.test' });

    const count = await bulkCreateGroupRules({
      groupId,
      type: 'whitelist',
      values: ['duplicate.test', 'new.test', 'new.test'],
    });

    const rules = await listGroupRules({ groupId });

    assert.strictEqual(count, 1);
    assert.strictEqual(rules.length, 2);
  });

  it('deletes a rule only when it belongs to the requested group', async () => {
    const groupId = await seedGroup('Delete Rule Group');
    const otherGroupId = await seedGroup('Delete Rule Other Group');
    const ruleId = await seedRule({ groupId, type: 'whitelist', value: 'delete.test' });

    await assert.rejects(() => deleteGroupRule({ id: ruleId, groupId: otherGroupId }), {
      message: 'Rule not found',
    });

    const deleted = await deleteGroupRule({ id: ruleId, groupId });
    const remainingRules = await listGroupRules({ groupId });

    assert.strictEqual(deleted, true);
    assert.strictEqual(remainingRules.length, 0);
  });

  it('revokes an automatic approval by replacing it with an explicit block', async () => {
    const groupId = await seedGroup('Revoke Auto Approval Group');
    const ruleId = await seedRule({
      groupId,
      type: 'whitelist',
      value: 'cdn.example.com',
      source: 'auto_extension',
    });

    const result = await revokeAutoApprovalRule({
      id: ruleId,
      groupId,
      resolvedBy: 'teacher@example.com',
    });
    const rules = await listGroupRules({ groupId });

    assert.deepStrictEqual(result.revoked, true);
    assert.strictEqual(
      rules.some((rule) => rule.id === ruleId),
      false
    );
    assert.strictEqual(
      rules.some(
        (rule) =>
          rule.type === 'blocked_subdomain' &&
          rule.value === 'cdn.example.com' &&
          rule.source === 'manual' &&
          rule.comment === 'Revoked automatic approval by teacher@example.com'
      ),
      true
    );
  });

  it('rejects revocation of non-automatic rules', async () => {
    const groupId = await seedGroup('Reject Manual Revoke Group');
    const ruleId = await seedRule({
      groupId,
      type: 'whitelist',
      value: 'manual.example.com',
    });

    await assert.rejects(
      () =>
        revokeAutoApprovalRule({
          id: ruleId,
          groupId,
          resolvedBy: 'teacher@example.com',
        }),
      { message: 'Only automatic whitelist approvals can be revoked this way' }
    );
  });

  it('updates a rule value and comment while reporting whether the value changed', async () => {
    const groupId = await seedGroup('Update Rule Group');
    const ruleId = await seedRule({
      groupId,
      type: 'whitelist',
      value: 'mixed.test',
      comment: 'old',
    });

    const result = await updateGroupRule({
      id: ruleId,
      groupId,
      value: ' Normalized.Test ',
      comment: null,
    });

    assert.strictEqual(result.valueChanged, true);
    assert.strictEqual(result.rule.value, 'normalized.test');
    assert.strictEqual(result.rule.comment, null);
  });

  it('rejects updates that would duplicate another rule value in the same group', async () => {
    const groupId = await seedGroup('Duplicate Update Group');
    await seedRule({ groupId, type: 'whitelist', value: 'alpha.test' });
    const ruleId = await seedRule({ groupId, type: 'whitelist', value: 'beta.test' });

    await assert.rejects(
      () =>
        updateGroupRule({
          id: ruleId,
          groupId,
          value: ' ALPHA.TEST ',
        }),
      { message: 'A rule with this value already exists' }
    );
  });
});
