import { eq } from 'drizzle-orm';

import { openpathDb, schedules } from '../openpath.js';
import { notifyOpenPathClassroomChanged } from './publish.js';

// Owning module for schedules writes. Pairing (F5): every effective schedule
// change notifies the affected classroom. Methods return undefined instead of
// throwing when the write matched nothing, WITHOUT notifying -- callers keep
// their existing TRPC error mapping, and the notify-after-success order is
// identical to the pre-refactor services. deleteScheduleAndNotify keeps the
// pre-refactor quirk of notifying even when the DELETE matched 0 rows
// (plan F13(a)).

export type ScheduleRow = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export async function createScheduleAndNotify(
  values: NewSchedule
): Promise<ScheduleRow | undefined> {
  const [created] = await openpathDb.insert(schedules).values(values).returning();

  if (!created) {
    return undefined;
  }

  await notifyOpenPathClassroomChanged(created.classroomId);
  return created;
}

export async function updateScheduleAndNotify(
  scheduleId: string,
  set: Partial<NewSchedule>
): Promise<ScheduleRow | undefined> {
  const [updated] = await openpathDb
    .update(schedules)
    .set(set)
    .where(eq(schedules.id, scheduleId))
    .returning();

  if (!updated) {
    return undefined;
  }

  await notifyOpenPathClassroomChanged(updated.classroomId);
  return updated;
}

export async function deleteScheduleAndNotify(
  scheduleId: string,
  classroomId: string
): Promise<void> {
  await openpathDb.delete(schedules).where(eq(schedules.id, scheduleId));
  await notifyOpenPathClassroomChanged(classroomId);
}
