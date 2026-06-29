import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { normalizeTimeHHMM, parseTimeToMinutes } from './schedule-time.js';
import { isOrgAdmin } from '../../lib/tenant-access.js';

export type DbSchedule = typeof schedules.$inferSelect;

export type ScheduleWriteContext = Parameters<typeof isOrgAdmin>[0] & {
  organizationId?: string;
  user: { sub: string };
};

export function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

/**
 * Allowed minute step for schedule start/end times.
 *
 * Source of truth lives in OpenPath (`@openpath/shared`'s
 * SCHEDULE_TIME_STEP_MINUTES). This is a deliberate local copy of the wrapper's
 * validator; the cross-repo contract test in this package guards that the two
 * values stay in sync. Keep them equal.
 */
export const SCHEDULE_TIME_STEP_MINUTES = 5;

export function assertQuarterHour(t: string, field: string): void {
  const minutes = parseTimeToMinutes(t);
  if (!Number.isFinite(minutes)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid time` });
  }
  const minuteOfHour = minutes % 60;
  if (minuteOfHour % SCHEDULE_TIME_STEP_MINUTES !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in ${String(SCHEDULE_TIME_STEP_MINUTES)}-minute increments`,
    });
  }
}

export function parseIsoDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid date` });
  }
  return parsed;
}

export function assertQuarterHourInstant(date: Date, field: string): void {
  if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must not include seconds` });
  }
  if (date.getUTCMinutes() % SCHEDULE_TIME_STEP_MINUTES !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in ${String(SCHEDULE_TIME_STEP_MINUTES)}-minute increments`,
    });
  }
}

export async function assertNoOneOffConflict(params: {
  classroomId: string;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
}): Promise<void> {
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

  const conflicts = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(conditions)
    .limit(1);

  if (conflicts.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ese tramo horario ya está reservado',
    });
  }
}

export async function assertNoConflict(params: {
  classroomId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  excludeId?: string;
}): Promise<void> {
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

  const conflicts = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(conditions)
    .limit(1);

  if (conflicts.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ese tramo horario ya está reservado',
    });
  }
}

export function assertCanManageSchedule(ctx: ScheduleWriteContext, schedule: DbSchedule): void {
  const admin = isOrgAdmin(ctx);
  const isOwner = schedule.teacherId === ctx.user.sub;
  if (!admin && !isOwner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only manage your own schedules' });
  }
}

export function mapToWeeklyScheduleBase(schedule: DbSchedule) {
  if (schedule.dayOfWeek === null || schedule.startTime === null || schedule.endTime === null) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Invalid weekly schedule row' });
  }

  return {
    id: schedule.id,
    classroomId: schedule.classroomId,
    dayOfWeek: schedule.dayOfWeek,
    startTime: normalizeTimeHHMM(schedule.startTime),
    endTime: normalizeTimeHHMM(schedule.endTime),
    groupId: schedule.groupId,
    teacherId: schedule.teacherId,
    recurrence: schedule.recurrence ?? 'weekly',
    createdAt: schedule.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: schedule.updatedAt?.toISOString?.() ?? undefined,
  };
}

export function mapToOneOffScheduleBase(schedule: DbSchedule) {
  return {
    id: schedule.id,
    classroomId: schedule.classroomId,
    startAt: schedule.startAt?.toISOString?.() ?? null,
    endAt: schedule.endAt?.toISOString?.() ?? null,
    groupId: schedule.groupId,
    teacherId: schedule.teacherId,
    recurrence: 'one_off' as const,
    createdAt: schedule.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: schedule.updatedAt?.toISOString?.() ?? undefined,
  };
}

export async function loadScheduleOrThrow(id: string): Promise<DbSchedule> {
  const existing = await openpathDb.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  const schedule = existing[0];
  if (!schedule) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
  }
  return schedule;
}

export function getWeeklyScheduleBase(schedule: DbSchedule) {
  if (schedule.recurrence === 'one_off') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not weekly' });
  }

  if (schedule.dayOfWeek === null || schedule.startTime === null || schedule.endTime === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid weekly schedule' });
  }

  return {
    dayOfWeek: schedule.dayOfWeek,
    startTime: normalizeTimeHHMM(schedule.startTime),
    endTime: normalizeTimeHHMM(schedule.endTime),
  };
}

export function getOneOffScheduleBase(schedule: DbSchedule) {
  if (schedule.recurrence !== 'one_off') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not one-off' });
  }

  if (!schedule.startAt || !schedule.endAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid one-off schedule' });
  }

  return {
    startAt: schedule.startAt,
    endAt: schedule.endAt,
  };
}
