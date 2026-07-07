import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

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

// Shared predicate: a schedule counts as "weekly" when its recurrence column
// is explicitly 'weekly' OR unset (legacy rows predate the recurrence
// column). This is the canonical definition; schedule-write-shared.service.ts
// re-exports it for its callers instead of holding its own copy. Two other
// call sites (current-group-read/current-group-expiration) keep their own
// private one-line copies -- those files are gnarly time-of-day math left on
// the raw-mirror ratchet, not migrated here (see openpath-repo-boundary
// allowlist). This predicate carries no tenant or business-rule logic.
export function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

export async function getScheduleById(id: string): Promise<ScheduleRow | undefined> {
  const rows = await openpathDb.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  return rows[0];
}

export async function getWeeklySchedulesForClassroom(classroomId: string): Promise<ScheduleRow[]> {
  return openpathDb
    .select()
    .from(schedules)
    .where(and(eq(schedules.classroomId, classroomId), weeklyRecurrenceWhereClause()))
    .orderBy(schedules.dayOfWeek, schedules.startTime);
}

export async function getOneOffSchedulesForClassroom(classroomId: string): Promise<ScheduleRow[]> {
  return openpathDb
    .select()
    .from(schedules)
    .where(and(eq(schedules.classroomId, classroomId), eq(schedules.recurrence, 'one_off')))
    .orderBy(schedules.startAt);
}

export async function getWeeklySchedulesForTeacher(params: {
  teacherId: string;
  classroomIds: readonly string[];
}): Promise<ScheduleRow[]> {
  return openpathDb
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.teacherId, params.teacherId),
        inArray(schedules.classroomId, [...params.classroomIds]),
        weeklyRecurrenceWhereClause()
      )
    )
    .orderBy(schedules.dayOfWeek, schedules.startTime);
}

export async function findConflictingOneOffScheduleId(params: {
  classroomId: string;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
}): Promise<string | undefined> {
  const { classroomId, startAt, endAt, excludeId } = params;

  const conditions =
    excludeId !== undefined
      ? and(
          eq(schedules.classroomId, classroomId),
          eq(schedules.recurrence, 'one_off'),
          sql`${schedules.startAt} < ${endAt} AND ${schedules.endAt} > ${startAt}`,
          sql`${schedules.id} != ${excludeId}::uuid`
        )
      : and(
          eq(schedules.classroomId, classroomId),
          eq(schedules.recurrence, 'one_off'),
          sql`${schedules.startAt} < ${endAt} AND ${schedules.endAt} > ${startAt}`
        );

  const rows = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(conditions)
    .limit(1);
  return rows[0]?.id;
}

export async function findConflictingWeeklyScheduleId(params: {
  classroomId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  excludeId?: string;
}): Promise<string | undefined> {
  const { classroomId, dayOfWeek, startTime, endTime, excludeId } = params;

  const overlaps = sql`(${startTime}::time, ${endTime}::time) OVERLAPS (${schedules.startTime}, ${schedules.endTime})`;
  const conditions =
    excludeId !== undefined
      ? and(
          eq(schedules.classroomId, classroomId),
          weeklyRecurrenceWhereClause(),
          eq(schedules.dayOfWeek, dayOfWeek),
          overlaps,
          sql`${schedules.id} != ${excludeId}::uuid`
        )
      : and(
          eq(schedules.classroomId, classroomId),
          weeklyRecurrenceWhereClause(),
          eq(schedules.dayOfWeek, dayOfWeek),
          overlaps
        );

  const rows = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(conditions)
    .limit(1);
  return rows[0]?.id;
}

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
