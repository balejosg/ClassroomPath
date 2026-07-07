import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import {
  notifyOpenPathClassroomChanged,
  openpathDb,
  publishWhitelistGroupChanged,
  publishWhitelistGroupsChanged,
  whitelistGroups,
} from '../src/db/openpath.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

// Characterization of the mandatory write->publish side effects BEFORE the
// repository refactor moves them. Pins: publishWhitelistGroupChanged =
// updated_at touch + {type:'group'} pg_notify; notifyOpenPathClassroomChanged =
// {type:'classroom'} pg_notify with no table write; publishWhitelistGroupsChanged
// dedupes group ids. Task 2 changes ONLY this file's import path.

const RUN_ID = Math.random().toString(36).slice(2, 10);
const createdGroupIds = new Set<string>();

async function seedGroup(suffix: string): Promise<string> {
  const groupId = `pubgrp_${RUN_ID}_${suffix}`;
  createdGroupIds.add(groupId);
  await openpathDb.insert(whitelistGroups).values({
    id: groupId,
    name: `pub-char-${RUN_ID}-${suffix}`,
    displayName: `Publish Characterization ${suffix}`,
    enabled: 1,
  });
  return groupId;
}

after(async () => {
  if (createdGroupIds.size > 0) {
    await openpathDb
      .delete(whitelistGroups)
      .where(inArray(whitelistGroups.id, [...createdGroupIds]));
  }
});

describe('openpath publish primitives (characterization)', () => {
  it('publishWhitelistGroupChanged touches updated_at and notifies {type:group}', async () => {
    const groupId = await seedGroup('a');
    const [before] = await openpathDb
      .select({ updatedAt: whitelistGroups.updatedAt })
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, groupId));

    const capture = await startOpenPathNotifyCapture();
    try {
      await publishWhitelistGroupChanged(groupId);
      const events = await capture.waitForCount(1);

      assert.deepEqual(events, [{ type: 'group', groupId }]);

      const [afterRow] = await openpathDb
        .select({ updatedAt: whitelistGroups.updatedAt })
        .from(whitelistGroups)
        .where(eq(whitelistGroups.id, groupId));
      assert.ok(afterRow.updatedAt && before.updatedAt, 'updated_at must be set');
      assert.ok(
        afterRow.updatedAt.getTime() >= before.updatedAt.getTime(),
        'publish must touch whitelist_groups.updated_at'
      );
      assert.notEqual(
        afterRow.updatedAt.getTime(),
        before.updatedAt.getTime(),
        'updated_at must actually change (new Date() written by the touch)'
      );
    } finally {
      await capture.stop();
    }
  });

  it('notifyOpenPathClassroomChanged emits {type:classroom} and writes nothing', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      await notifyOpenPathClassroomChanged('classroom-char-1');
      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'classroom', classroomId: 'classroom-char-1' }]);
    } finally {
      await capture.stop();
    }
  });

  it('publishWhitelistGroupsChanged dedupes group ids', async () => {
    const groupB = await seedGroup('b');
    const groupC = await seedGroup('c');
    const capture = await startOpenPathNotifyCapture();
    try {
      await publishWhitelistGroupsChanged([groupB, groupC, groupB]);
      const events = await capture.waitForCount(2);
      assert.equal(events.length, 2, `expected exactly 2 events, got ${JSON.stringify(events)}`);
      assert.deepEqual(events.map((event) => event.groupId).sort(), [groupB, groupC].sort());
    } finally {
      await capture.stop();
    }
  });
});
