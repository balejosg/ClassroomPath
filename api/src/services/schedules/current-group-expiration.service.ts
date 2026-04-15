import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { getScheduleClock, normalizeTimeHHMM, parseTimeToMinutes } from './schedule-time.js';

function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

export function calculateWeeklyScheduleExpiresAt(params: {
  now: Date;
  nowTimeHHMM: string;
  endTime: string | null;
}): Date {
  const endHHMM = normalizeTimeHHMM(params.endTime);
  const nowMin = parseTimeToMinutes(params.nowTimeHHMM);
  const endMin = parseTimeToMinutes(endHHMM);
  if (!Number.isFinite(nowMin) || !Number.isFinite(endMin) || endMin <= nowMin) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid schedule end time' });
  }

  const msIntoMinute = params.now.getSeconds() * 1000 + params.now.getMilliseconds();
  return new Date(params.now.getTime() - msIntoMinute + (endMin - nowMin) * 60_000);
}

export async function resolveActiveScheduleExpiresAt(params: {
  classroomId: string;
  scheduleId: string;
  now: Date;
}): Promise<Date> {
  const { classroomId, scheduleId, now } = params;

  const activeOneOffRows = await openpathDb
    .select({ endAt: schedules.endAt })
    .from(schedules)
    .where(
      and(
        eq(schedules.id, scheduleId),
        eq(schedules.classroomId, classroomId),
        eq(schedules.recurrence, 'one_off'),
        sql`${schedules.startAt} <= ${now} AND ${schedules.endAt} > ${now}`
      )
    )
    .limit(1);

  const activeOneOff = activeOneOffRows[0];
  if (activeOneOff) {
    if (!activeOneOff.endAt) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid one-off schedule end time',
      });
    }
    return activeOneOff.endAt;
  }

  const { dayOfWeek, timeHHMM } = getScheduleClock(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Schedules are inactive on weekends',
    });
  }

  const scheduleRows = await openpathDb
    .select({ endTime: schedules.endTime })
    .from(schedules)
    .where(
      and(
        eq(schedules.id, scheduleId),
        eq(schedules.classroomId, classroomId),
        weeklyRecurrenceWhereClause(),
        eq(schedules.dayOfWeek, dayOfWeek),
        sql`${schedules.startTime} <= ${timeHHMM}::time`,
        sql`${schedules.endTime} > ${timeHHMM}::time`
      )
    )
    .limit(1);

  const schedule = scheduleRows[0];
  if (!schedule) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not active' });
  }

  return calculateWeeklyScheduleExpiresAt({
    now,
    nowTimeHHMM: timeHHMM,
    endTime: schedule.endTime,
  });
}
