import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import {
  classrooms,
  machineExemptions,
  machines,
  openpathDb,
  schedules,
  users,
  whitelistGroups,
} from '../src/db/openpath.js';
import {
  createClassroom,
  deleteClassroomById,
  deleteMachineFromClassroom,
  getMachineClassroomLink,
  setActiveGroupAndNotify,
  updateCaptivePortalDomainsIfSupported,
} from '../src/db/openpath-repos/classrooms.repo.js';
import {
  createScheduleExemptionAndNotify,
  deleteExemptionAndNotify,
  getExemptionById,
} from '../src/db/openpath-repos/machine-exemptions.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const classroomIds = new Set<string>();
const machineIds = new Set<string>();
const exemptionIds = new Set<string>();

// The physical machine_exemptions table enforces schedule_id -> schedules(id)
// and created_by -> users(id) FKs (schema.sql) stricter than the nullable
// Drizzle mirror type -- and schedules itself enforces classroom_id/teacher_id/
// group_id FKs. Seed the rows the brief's literal scheduleId/createdBy values
// reference so the insert satisfies those constraints, same pattern as
// schedules.repo.test.ts / whitelist-rules.repo.test.ts. onConflictDoNothing
// tolerates leftovers from a previously crashed run of this same fixed literal.
const FK_SCHEDULE_ID = '00000000-0000-4000-8000-00000000abcd';
const FK_CREATED_BY = 'repo-test';
const FK_CLASSROOM_ID = `croom_fk_seed_${RUN_ID}`;
const FK_TEACHER_ID = `teacher_fk_seed_${RUN_ID}`;
const FK_GROUP_ID = `group_fk_seed_${RUN_ID}`;

before(async () => {
  await openpathDb.insert(classrooms).values({
    id: FK_CLASSROOM_ID,
    name: `croom-fk-seed-${RUN_ID}`,
    displayName: 'Classrooms Repo FK Seed',
  });
  await openpathDb.insert(users).values({
    id: FK_TEACHER_ID,
    email: `classrooms-repo-fk-${RUN_ID}@test.local`,
    name: 'Classrooms Repo FK Seed Teacher',
  });
  await openpathDb
    .insert(users)
    .values({
      id: FK_CREATED_BY,
      email: `classrooms-repo-fk-createdby-${RUN_ID}@test.local`,
      name: 'Classrooms Repo FK Seed CreatedBy',
    })
    .onConflictDoNothing();
  await openpathDb.insert(whitelistGroups).values({
    id: FK_GROUP_ID,
    name: `croom-fk-seed-group-${RUN_ID}`,
    displayName: 'Classrooms Repo FK Seed Group',
    enabled: 1,
  });
  await openpathDb
    .insert(schedules)
    .values({
      id: FK_SCHEDULE_ID,
      classroomId: FK_CLASSROOM_ID,
      teacherId: FK_TEACHER_ID,
      groupId: FK_GROUP_ID,
      recurrence: 'one_off',
    })
    .onConflictDoNothing();
});

after(async () => {
  if (exemptionIds.size > 0) {
    await openpathDb
      .delete(machineExemptions)
      .where(inArray(machineExemptions.id, [...exemptionIds]));
  }
  if (machineIds.size > 0) {
    await openpathDb.delete(machines).where(inArray(machines.id, [...machineIds]));
  }
  if (classroomIds.size > 0) {
    await openpathDb.delete(classrooms).where(inArray(classrooms.id, [...classroomIds]));
  }
  await openpathDb.delete(schedules).where(eq(schedules.id, FK_SCHEDULE_ID));
  await openpathDb.delete(classrooms).where(eq(classrooms.id, FK_CLASSROOM_ID));
  await openpathDb.delete(users).where(eq(users.id, FK_TEACHER_ID));
  await openpathDb.delete(users).where(eq(users.id, FK_CREATED_BY));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, FK_GROUP_ID));
});

describe('classrooms.repo + machine-exemptions.repo', () => {
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

  it('schedule exemption create: conflict falls back to the existing row; notify per successful call', async () => {
    const room = await createClassroom({
      id: `croom_${RUN_ID}_2`,
      name: `croom-repo-${RUN_ID}-2`,
      displayName: 'Classrooms Repo 2',
    });
    classroomIds.add(room.id);
    await openpathDb.insert(machines).values({
      id: `mach_${RUN_ID}_1`,
      hostname: `mach-repo-${RUN_ID}-1`,
      classroomId: room.id,
    });
    machineIds.add(`mach_${RUN_ID}_1`);

    const link = await getMachineClassroomLink(`mach_${RUN_ID}_1`);
    assert.equal(link?.classroomId, room.id);

    const scheduleId = '00000000-0000-4000-8000-00000000abcd';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const capture = await startOpenPathNotifyCapture();
    try {
      const first = await createScheduleExemptionAndNotify({
        id: `exempt_${RUN_ID}_1`,
        machineId: `mach_${RUN_ID}_1`,
        classroomId: room.id,
        scheduleId,
        groupId: null,
        createdBy: 'repo-test',
        expiresAt,
      });
      assert.ok(first);
      exemptionIds.add(first.id);

      const second = await createScheduleExemptionAndNotify({
        id: `exempt_${RUN_ID}_2`,
        machineId: `mach_${RUN_ID}_1`,
        classroomId: room.id,
        scheduleId,
        groupId: null,
        createdBy: 'repo-test',
        expiresAt,
      });
      assert.equal(second?.id, first.id, 'conflict path returns the existing row');

      const events = await capture.waitForCount(2);
      assert.equal(events.length, 2, 'both successful calls notify, as the service did');

      const fetched = await getExemptionById(first.id);
      assert.equal(fetched?.source, 'schedule');

      await deleteExemptionAndNotify(first.id, room.id);
      assert.equal(await getExemptionById(first.id), undefined);
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
