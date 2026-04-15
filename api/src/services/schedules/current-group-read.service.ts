import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { getScheduleClock } from './schedule-time.js';

function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

export async function getCurrentWeeklyScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const date = params.date ?? new Date();
  const { dayOfWeek, timeHHMM } = getScheduleClock(date);

  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const rows = await openpathDb
    .select({ groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        eq(schedules.classroomId, params.classroomId),
        weeklyRecurrenceWhereClause(),
        eq(schedules.dayOfWeek, dayOfWeek),
        sql`${schedules.startTime} <= ${timeHHMM}::time`,
        sql`${schedules.endTime} > ${timeHHMM}::time`
      )
    )
    .limit(1);

  return rows[0]?.groupId ?? null;
}

export async function getCurrentOneOffScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const date = params.date ?? new Date();

  const rows = await openpathDb
    .select({ groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        eq(schedules.classroomId, params.classroomId),
        eq(schedules.recurrence, 'one_off'),
        sql`${schedules.startAt} <= ${date} AND ${schedules.endAt} > ${date}`
      )
    )
    .limit(1);

  return rows[0]?.groupId ?? null;
}

export async function getCurrentScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const oneOff = await getCurrentOneOffScheduleGroupId(params);
  if (oneOff) return oneOff;
  return getCurrentWeeklyScheduleGroupId(params);
}

export async function getCurrentScheduleGroupByClassroomId(params: {
  classroomIds: string[];
  date?: Date | undefined;
}): Promise<Map<string, string>> {
  const date = params.date ?? new Date();
  const classroomIds = params.classroomIds;
  const scheduleGroupByClassroomId = new Map<string, string>();

  if (classroomIds.length === 0) return scheduleGroupByClassroomId;

  const activeOneOffRows = await openpathDb
    .select({ classroomId: schedules.classroomId, groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        inArray(schedules.classroomId, classroomIds),
        eq(schedules.recurrence, 'one_off'),
        sql`${schedules.startAt} <= ${date} AND ${schedules.endAt} > ${date}`
      )
    );

  for (const row of activeOneOffRows) {
    if (!scheduleGroupByClassroomId.has(row.classroomId)) {
      scheduleGroupByClassroomId.set(row.classroomId, row.groupId);
    }
  }

  const { dayOfWeek, timeHHMM } = getScheduleClock(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) return scheduleGroupByClassroomId;

  const activeWeeklyRows = await openpathDb
    .select({ classroomId: schedules.classroomId, groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        inArray(schedules.classroomId, classroomIds),
        weeklyRecurrenceWhereClause(),
        eq(schedules.dayOfWeek, dayOfWeek),
        sql`${schedules.startTime} <= ${timeHHMM}::time`,
        sql`${schedules.endTime} > ${timeHHMM}::time`
      )
    );

  for (const row of activeWeeklyRows) {
    if (!scheduleGroupByClassroomId.has(row.classroomId)) {
      scheduleGroupByClassroomId.set(row.classroomId, row.groupId);
    }
  }

  return scheduleGroupByClassroomId;
}
