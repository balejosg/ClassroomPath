import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { classrooms, openpathDb, schedules, users, whitelistGroups } from '../src/db/openpath.js';
import {
  createScheduleAndNotify,
  deleteScheduleAndNotify,
  updateScheduleAndNotify,
} from '../src/db/openpath-repos/schedules.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const CLASSROOM_ID = `sched-repo-room-${RUN_ID}`;
const TEACHER_ID = `teacher-${RUN_ID}`;
const GROUP_ID = `group-${RUN_ID}`;
const createdScheduleIds = new Set<string>();

// The physical `schedules` table enforces classroom_id / teacher_id / group_id
// FKs (schema.sql) stricter than the nullable Drizzle mirror type. Seed the
// referenced rows so inserts satisfy those constraints -- same pattern as
// requests.repo.test.ts / whitelist-rules.repo.test.ts.
before(async () => {
  await openpathDb.insert(classrooms).values({
    id: CLASSROOM_ID,
    name: `sched-repo-room-${RUN_ID}`,
    displayName: 'Schedules Repo Test Classroom',
  });
  await openpathDb.insert(users).values({
    id: TEACHER_ID,
    email: `sched-repo-${RUN_ID}@test.local`,
    name: 'Schedules Repo Test Teacher',
  });
  await openpathDb.insert(whitelistGroups).values({
    id: GROUP_ID,
    name: `sched-repo-group-${RUN_ID}`,
    displayName: 'Schedules Repo Test Group',
    enabled: 1,
  });
});

after(async () => {
  if (createdScheduleIds.size > 0) {
    await openpathDb.delete(schedules).where(inArray(schedules.id, [...createdScheduleIds]));
  }
  await openpathDb.delete(classrooms).where(eq(classrooms.id, CLASSROOM_ID));
  await openpathDb.delete(users).where(eq(users.id, TEACHER_ID));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, GROUP_ID));
});

describe('schedules.repo', () => {
  it('createScheduleAndNotify inserts and notifies the classroom', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      const created = await createScheduleAndNotify({
        classroomId: CLASSROOM_ID,
        teacherId: `teacher-${RUN_ID}`,
        groupId: `group-${RUN_ID}`,
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '09:00',
      });
      assert.ok(created);
      createdScheduleIds.add(created.id);

      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'classroom', classroomId: CLASSROOM_ID }]);
    } finally {
      await capture.stop();
    }
  });

  it('updateScheduleAndNotify updates and notifies; returns undefined without notify for a missing id', async () => {
    const created = await createScheduleAndNotify({
      classroomId: CLASSROOM_ID,
      teacherId: `teacher-${RUN_ID}`,
      groupId: `group-${RUN_ID}`,
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '11:00',
    });
    assert.ok(created);
    createdScheduleIds.add(created.id);

    const capture = await startOpenPathNotifyCapture();
    try {
      const updated = await updateScheduleAndNotify(created.id, { dayOfWeek: 3 });
      assert.equal(updated?.dayOfWeek, 3);

      const missing = await updateScheduleAndNotify('00000000-0000-4000-8000-000000000000', {
        dayOfWeek: 4,
      });
      assert.equal(missing, undefined);

      const events = await capture.waitForCount(1, 800);
      assert.equal(events.length, 1, 'exactly one notify: none for the missing id');
    } finally {
      await capture.stop();
    }
  });

  it('deleteScheduleAndNotify notifies with the caller-supplied classroom even for 0 rows (pinned quirk)', async () => {
    const capture = await startOpenPathNotifyCapture();
    try {
      await deleteScheduleAndNotify('00000000-0000-4000-8000-000000000001', CLASSROOM_ID);
      const events = await capture.waitForCount(1);
      assert.deepEqual(events, [{ type: 'classroom', classroomId: CLASSROOM_ID }]);
    } finally {
      await capture.stop();
    }
  });
});
