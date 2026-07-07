import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { classrooms, machines, openpathDb } from '../src/db/openpath.js';
import {
  createClassroom,
  deleteClassroomById,
  deleteMachineFromClassroom,
  setActiveGroupAndNotify,
  updateCaptivePortalDomainsIfSupported,
} from '../src/db/openpath-repos/classrooms.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

// Self-contained 1:1 gate-named coverage for classrooms.repo.ts. Pins the
// write/notify flavors preserved by the repository refactor (plan F5/F13):
// createClassroom and the two deletes are BARE (no notify -- the delete
// no-notify is the pinned F13(d) gap); setActiveGroupAndNotify pairs write+notify
// on success only; updateCaptivePortalDomainsIfSupported returns true when the
// column exists. Mirrors the classroom assertions co-located in
// machine-exemptions.repo.test.ts, with its own seed/cleanup.

const RUN_ID = Math.random().toString(36).slice(2, 10);
const classroomIds = new Set<string>();
const machineIds = new Set<string>();

after(async () => {
  if (machineIds.size > 0) {
    await openpathDb.delete(machines).where(inArray(machines.id, [...machineIds]));
  }
  if (classroomIds.size > 0) {
    await openpathDb.delete(classrooms).where(inArray(classrooms.id, [...classroomIds]));
  }
});

describe('classrooms.repo (1:1 named)', () => {
  it('createClassroom is bare (no notify); setActiveGroupAndNotify notifies on success only', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      const room = await createClassroom({
        id: `croom_${RUN_ID}_1`,
        name: `croom-repo-${RUN_ID}-1`,
        displayName: 'Classrooms Repo 1',
      });
      classroomIds.add(room.id);
      assert.equal(
        (await capture.waitForCount(1, 400)).length,
        0,
        'create is a bare workflow write'
      );

      const updated = await setActiveGroupAndNotify(room.id, null);
      assert.ok(updated);
      const missing = await setActiveGroupAndNotify(`croom_missing_${RUN_ID}`, null);
      assert.equal(missing, undefined);

      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'classroom', classroomId: room.id }]);
    } finally {
      await capture.stop();
    }
  });

  it('deleteMachineFromClassroom and deleteClassroomById are bare (no notify -- pinned gap)', async () => {
    const room = await createClassroom({
      id: `croom_${RUN_ID}_3`,
      name: `croom-repo-${RUN_ID}-3`,
      displayName: 'Classrooms Repo 3',
    });
    classroomIds.add(room.id);
    await openpathDb.insert(machines).values({
      id: `mach_${RUN_ID}_2`,
      hostname: `mach-repo-${RUN_ID}-2`,
      classroomId: room.id,
    });
    machineIds.add(`mach_${RUN_ID}_2`);

    const capture = await startOpenPathNotifyCapture();
    try {
      await deleteMachineFromClassroom(`mach_${RUN_ID}_2`, room.id);
      await deleteClassroomById(room.id);
      assert.equal((await capture.waitForCount(1, 400)).length, 0);
    } finally {
      await capture.stop();
    }
  });

  it('updateCaptivePortalDomainsIfSupported returns true when the column exists', async () => {
    const room = await createClassroom({
      id: `croom_${RUN_ID}_4`,
      name: `croom-repo-${RUN_ID}-4`,
      displayName: 'Classrooms Repo 4',
    });
    classroomIds.add(room.id);
    assert.equal(await updateCaptivePortalDomainsIfSupported(room.id, ['portal.example']), true);
    const [row] = await openpathDb.select().from(classrooms).where(eq(classrooms.id, room.id));
    assert.deepEqual(row.captivePortalDomains, ['portal.example']);
  });
});
