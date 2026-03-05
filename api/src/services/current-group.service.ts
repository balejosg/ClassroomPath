import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { openpathDb, schedules } from '../db/openpath.js';

// Scheduling uses dayOfWeek + start/end times without timezone.
// To make "current schedule" deterministic in Docker (which often defaults to UTC),
// we compute "now" in an explicit timezone.
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || process.env.TZ || 'Europe/Madrid';

const WEEKDAY_BY_SHORT_EN: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getScheduleClock(date: Date): { dayOfWeek: number; timeHHMM: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourPartRaw = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;

    const dayOfWeek =
      weekday && WEEKDAY_BY_SHORT_EN[weekday] !== undefined
        ? WEEKDAY_BY_SHORT_EN[weekday]
        : date.getDay();
    const hourPart = hourPartRaw === '24' ? '00' : hourPartRaw;
    const timeHHMM =
      hourPart && minutePart ? `${hourPart}:${minutePart}` : date.toTimeString().slice(0, 5);

    return { dayOfWeek, timeHHMM };
  } catch {
    return { dayOfWeek: date.getDay(), timeHHMM: date.toTimeString().slice(0, 5) };
  }
}

export function normalizeTimeHHMM(t: string | null): string {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  if (hh !== undefined && mm !== undefined) return `${hh}:${mm}`;
  return String(t);
}

export function parseTimeToMinutes(t: string): number {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

export async function getCurrentWeeklyScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const date = params.date ?? new Date();
  const { dayOfWeek, timeHHMM } = getScheduleClock(date);

  // Only Mon-Fri scheduling is supported
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

  // One-off schedules (date/time based) can be active on weekends.
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
    // One-off schedules override weekly schedules.
    if (!scheduleGroupByClassroomId.has(row.classroomId)) {
      scheduleGroupByClassroomId.set(row.classroomId, row.groupId);
    }
  }

  return scheduleGroupByClassroomId;
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
