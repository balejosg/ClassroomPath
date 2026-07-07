import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, whitelistGroups, whitelistRules } from '../src/db/openpath.js';
import {
  bulkCreateRulesAndPublish,
  createOrReuseRuleAndPublish,
  deleteRuleAndPublish,
  deleteRulesByIdsAndPublishGroups,
  getRulesByIds,
  insertRuleIfAbsentAndPublish,
  updateRuleAndPublish,
} from '../src/db/openpath-repos/whitelist-rules.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const createdGroupIds = new Set<string>();
let counter = 0;

async function seedGroup(label: string): Promise<string> {
  counter += 1;
  const groupId = `rrepo_${RUN_ID}_${counter}`;
  createdGroupIds.add(groupId);
  await openpathDb.insert(whitelistGroups).values({
    id: groupId,
    name: `rules-repo-${RUN_ID}-${counter}`,
    displayName: label,
    enabled: 1,
  });
  return groupId;
}

after(async () => {
  const groupIds = [...createdGroupIds];
  if (groupIds.length === 0) return;
  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.groupId, groupIds));
  await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, groupIds));
});

describe('whitelist-rules.repo', () => {
  it('createOrReuseRuleAndPublish inserts once, publishes once, and reuses silently', async () => {
    const groupId = await seedGroup('create-or-reuse');
    const capture = await startOpenPathNotifyCapture();
    try {
      const created = await createOrReuseRuleAndPublish({
        groupId,
        type: 'whitelist',
        value: 'repo-example.com',
        comment: 'first',
      });
      assert.equal(created.created, true);
      assert.equal(created.row?.value, 'repo-example.com');

      const reused = await createOrReuseRuleAndPublish({
        groupId,
        type: 'whitelist',
        value: 'repo-example.com',
      });
      assert.equal(reused.created, false);
      assert.equal(reused.row?.id, created.row?.id);

      const events = await capture.waitForCount(1);
      assert.deepEqual(
        events,
        [{ type: 'group', groupId }],
        'exactly one publish, for the create only'
      );
    } finally {
      await capture.stop();
    }
  });

  it('bulkCreateRulesAndPublish publishes once for >0 inserts and not for all-duplicates', async () => {
    const groupId = await seedGroup('bulk');
    const capture = await startOpenPathNotifyCapture();
    try {
      const inserted = await bulkCreateRulesAndPublish({
        groupId,
        type: 'whitelist',
        values: ['bulk-a.com', 'bulk-b.com'],
      });
      assert.equal(inserted, 2);

      const insertedAgain = await bulkCreateRulesAndPublish({
        groupId,
        type: 'whitelist',
        values: ['bulk-a.com', 'bulk-b.com'],
      });
      assert.equal(insertedAgain, 0);

      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'group', groupId }]);
    } finally {
      await capture.stop();
    }
  });

  it('updateRuleAndPublish publishes only on value change; deleteRuleAndPublish publishes on delete', async () => {
    const groupId = await seedGroup('update-delete');
    const { row } = await createOrReuseRuleAndPublish({
      groupId,
      type: 'whitelist',
      value: 'mutate-me.com',
    });
    assert.ok(row);

    const capture = await startOpenPathNotifyCapture();
    try {
      const commentOnly = await updateRuleAndPublish({
        id: row.id,
        groupId,
        comment: 'annotated',
      });
      assert.equal(commentOnly.valueChanged, false);

      const valueChange = await updateRuleAndPublish({
        id: row.id,
        groupId,
        value: 'Mutated.com',
      });
      assert.equal(valueChange.valueChanged, true);
      assert.equal(valueChange.row.value, 'mutated.com');

      const deleted = await deleteRuleAndPublish({ id: row.id, groupId });
      assert.equal(deleted, true);

      const events = await capture.waitForCount(2);
      assert.deepEqual(events, [
        { type: 'group', groupId },
        { type: 'group', groupId },
      ]);
    } finally {
      await capture.stop();
    }
  });

  it('insertRuleIfAbsentAndPublish keeps the caller-supplied id and skips publish on conflict', async () => {
    const groupId = await seedGroup('if-absent');
    const capture = await startOpenPathNotifyCapture();
    try {
      const created = await insertRuleIfAbsentAndPublish({
        id: `rule-${RUN_ID}-approve`,
        groupId,
        type: 'whitelist',
        value: 'approved.com',
      });
      assert.equal(created, true);
      const again = await insertRuleIfAbsentAndPublish({
        id: `rule-${RUN_ID}-approve-2`,
        groupId,
        type: 'whitelist',
        value: 'approved.com',
      });
      assert.equal(again, false);

      const [stored] = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.id, `rule-${RUN_ID}-approve`));
      assert.ok(stored, 'the caller-supplied id must be persisted');

      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'group', groupId }]);
    } finally {
      await capture.stop();
    }
  });

  it('deleteRulesByIdsAndPublishGroups deletes by id and publishes each affected group once', async () => {
    const groupA = await seedGroup('bulk-del-a');
    const groupB = await seedGroup('bulk-del-b');
    const { row: ruleA } = await createOrReuseRuleAndPublish({
      groupId: groupA,
      type: 'whitelist',
      value: 'del-a.com',
    });
    const { row: ruleB } = await createOrReuseRuleAndPublish({
      groupId: groupB,
      type: 'whitelist',
      value: 'del-b.com',
    });
    assert.ok(ruleA && ruleB);

    const fetched = await getRulesByIds([ruleA.id, ruleB.id]);
    assert.equal(fetched.length, 2);

    const capture = await startOpenPathNotifyCapture();
    try {
      await deleteRulesByIdsAndPublishGroups({
        ruleIds: [ruleA.id, ruleB.id],
        groupIds: [groupA, groupB, groupA],
      });
      const events = await capture.waitForCount(2);
      assert.deepEqual(
        events.map((event) => event.groupId).sort(),
        [groupA, groupB].sort(),
        'dedupe: one publish per affected group'
      );
    } finally {
      await capture.stop();
    }
  });
});
