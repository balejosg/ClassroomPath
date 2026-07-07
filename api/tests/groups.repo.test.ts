import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, whitelistGroups, whitelistRules } from '../src/db/openpath.js';
import {
  createGroupWithRules,
  deleteGroupCascade,
  getGroupById,
  getGroupDisplayNamesByIds,
  updateGroupAndNotify,
} from '../src/db/openpath-repos/groups.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const createdGroupIds = new Set<string>();

after(async () => {
  const ids = [...createdGroupIds];
  if (ids.length === 0) return;
  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.groupId, ids));
  await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, ids));
});

describe('groups.repo', () => {
  it('createGroupWithRules seeds group + rules in one transaction WITHOUT publishing (workflow publishes)', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      const created = await createGroupWithRules({
        name: `grepo-${RUN_ID}-seeded`,
        displayName: 'Groups Repo Seeded',
        enabled: 1,
        rules: [
          { type: 'whitelist', value: 'seed-a.com', comment: null },
          { type: 'whitelist', value: 'seed-b.com', comment: 'second' },
        ],
      });
      createdGroupIds.add(created.id);

      const rules = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.groupId, created.id));
      assert.equal(rules.length, 2);

      const events = await capture.waitForCount(1, 500);
      assert.equal(
        events.length,
        0,
        'bare workflow-step write: publish is the ledger complete step'
      );
    } finally {
      await capture.stop();
    }
  });

  it('updateGroupAndNotify updates and notifies {type:group} unconditionally', async () => {
    const created = await createGroupWithRules({
      name: `grepo-${RUN_ID}-upd`,
      displayName: 'Before',
      enabled: 1,
      rules: [],
    });
    createdGroupIds.add(created.id);

    const capture = await startOpenPathNotifyCapture();
    try {
      const updated = await updateGroupAndNotify(created.id, {
        updatedAt: new Date(),
        displayName: 'After',
      });
      assert.ok(updated, 'an existing group updates and returns the row');
      assert.equal(updated.displayName, 'After');

      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'group', groupId: created.id }]);
    } finally {
      await capture.stop();
    }
  });

  it('updateGroupAndNotify returns undefined and emits no event for a vanished group', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      const updated = await updateGroupAndNotify(`missing-${RUN_ID}`, {
        updatedAt: new Date(),
        displayName: 'x',
      });
      assert.equal(updated, undefined);

      const events = await capture.waitForCount(1, 400);
      assert.equal(events.length, 0, 'no update happened, so no notify');
    } finally {
      await capture.stop();
    }
  });

  it('deleteGroupCascade removes rules then group, no publish of its own', async () => {
    const created = await createGroupWithRules({
      name: `grepo-${RUN_ID}-del`,
      displayName: 'Cascade Me',
      enabled: 1,
      rules: [{ type: 'whitelist', value: 'cascade.com', comment: null }],
    });
    createdGroupIds.add(created.id);

    const capture = await startOpenPathNotifyCapture();
    try {
      await deleteGroupCascade(created.id);
      assert.equal(await getGroupById(created.id), undefined);
      const events = await capture.waitForCount(1, 500);
      assert.equal(events.length, 0, 'delete workflow notifies in completeDelete, not here');
    } finally {
      await capture.stop();
    }
  });

  it('getGroupDisplayNamesByIds prefers displayName and falls back to name', async () => {
    const withDisplay = await createGroupWithRules({
      name: `grepo-${RUN_ID}-disp`,
      displayName: 'Pretty Name',
      enabled: 1,
      rules: [],
    });
    createdGroupIds.add(withDisplay.id);
    await openpathDb
      .update(whitelistGroups)
      .set({ displayName: '   ' })
      .where(eq(whitelistGroups.id, withDisplay.id));

    const map = await getGroupDisplayNamesByIds([withDisplay.id, '', withDisplay.id]);
    assert.equal(
      map.get(withDisplay.id),
      `grepo-${RUN_ID}-disp`,
      'blank displayName falls back to name'
    );
  });
});
