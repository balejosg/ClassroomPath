import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { openpathDb, schedules, notifyOpenPathClassroomChanged } from '../../db/openpath.js';
import { normalizeTimeHHMM, parseTimeToMinutes } from './schedule-time.js';
import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  isOrgAdmin,
} from '../../lib/tenant-access.js';

export type DbSchedule = typeof schedules.$inferSelect;

export type ScheduleWriteContext = Parameters<typeof isOrgAdmin>[0] & {
  organizationId?: string;
  user: { sub: string };
};

export interface WeeklyScheduleUpdateInput {
  id: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  groupId?: string;
}

export interface WeeklyScheduleCreateInput {
  classroomId: string;
  groupId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface OneOffScheduleUpdateInput {
  id: string;
  startAt?: string;
  endAt?: string;
  groupId?: string;
}

export interface OneOffScheduleCreateInput {
  classroomId: string;
  groupId: string;
  startAt: string;
  endAt: string;
}

export function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

export function assertQuarterHour(t: string, field: string): void {
  const minutes = parseTimeToMinutes(t);
  if (!Number.isFinite(minutes)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid time` });
  }
  const minuteOfHour = minutes % 60;
  if (minuteOfHour % 15 !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in 15-minute increments`,
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
  if (date.getUTCMinutes() % 15 !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in 15-minute increments`,
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
      message: 'Ese tramo horario ya esta reservado',
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
      message: 'Ese tramo horario ya esta reservado',
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

async function loadScheduleOrThrow(id: string): Promise<DbSchedule> {
  const existing = await openpathDb.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  const schedule = existing[0];
  if (!schedule) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
  }
  return schedule;
}

function getWeeklyScheduleBase(schedule: DbSchedule) {
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

function getOneOffScheduleBase(schedule: DbSchedule) {
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

export async function createWeeklyScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  input: WeeklyScheduleCreateInput;
}): Promise<DbSchedule> {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.classroomId);
  await assertOrgGroupAccess(params.ctx.organizationId!, params.input.groupId);

  await assertCanUseGroup(params.ctx, params.input.groupId, {
    notAllowedMessage: 'You can only create schedules for your assigned groups',
  });

  assertQuarterHour(params.input.startTime, 'startTime');
  assertQuarterHour(params.input.endTime, 'endTime');
  const start = parseTimeToMinutes(params.input.startTime);
  const end = parseTimeToMinutes(params.input.endTime);
  if (!(start < end)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'startTime must be before endTime' });
  }

  await assertNoConflict({
    classroomId: params.input.classroomId,
    dayOfWeek: params.input.dayOfWeek,
    startTime: params.input.startTime,
    endTime: params.input.endTime,
  });

  const [created] = await openpathDb
    .insert(schedules)
    .values({
      classroomId: params.input.classroomId,
      teacherId: params.ctx.user.sub,
      groupId: params.input.groupId,
      dayOfWeek: params.input.dayOfWeek,
      startTime: params.input.startTime,
      endTime: params.input.endTime,
      startAt: null,
      endAt: null,
      recurrence: 'weekly',
    })
    .returning();

  if (!created) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create schedule' });
  }

  await notifyOpenPathClassroomChanged(created.classroomId);

  return created;
}

export async function createOneOffScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  input: OneOffScheduleCreateInput;
}): Promise<DbSchedule> {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.classroomId);
  await assertOrgGroupAccess(params.ctx.organizationId!, params.input.groupId);

  await assertCanUseGroup(params.ctx, params.input.groupId, {
    notAllowedMessage: 'You can only create schedules for your assigned groups',
  });

  const startAt = parseIsoDate(params.input.startAt, 'startAt');
  const endAt = parseIsoDate(params.input.endAt, 'endAt');

  assertQuarterHourInstant(startAt, 'startAt');
  assertQuarterHourInstant(endAt, 'endAt');
  if (!(startAt.getTime() < endAt.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'endAt must be after startAt' });
  }

  await assertNoOneOffConflict({
    classroomId: params.input.classroomId,
    startAt,
    endAt,
  });

  const [created] = await openpathDb
    .insert(schedules)
    .values({
      classroomId: params.input.classroomId,
      teacherId: params.ctx.user.sub,
      groupId: params.input.groupId,
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      startAt,
      endAt,
      recurrence: 'one_off',
    })
    .returning();

  if (!created) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create one-off schedule',
    });
  }

  await notifyOpenPathClassroomChanged(created.classroomId);

  return created;
}

export async function updateWeeklyScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  input: WeeklyScheduleUpdateInput;
}): Promise<DbSchedule> {
  const schedule = await loadScheduleOrThrow(params.input.id);
  const weeklyBase = getWeeklyScheduleBase(schedule);

  await assertOrgClassroomAccess(params.ctx.organizationId!, schedule.classroomId);
  assertCanManageSchedule(params.ctx, schedule);

  const nextDayOfWeek = params.input.dayOfWeek ?? weeklyBase.dayOfWeek;
  const nextStart = params.input.startTime ?? weeklyBase.startTime;
  const nextEnd = params.input.endTime ?? weeklyBase.endTime;
  const nextGroupId = params.input.groupId ?? schedule.groupId;

  await assertOrgGroupAccess(params.ctx.organizationId!, nextGroupId);

  if (params.input.groupId !== undefined && params.input.groupId !== schedule.groupId) {
    await assertCanUseGroup(params.ctx, params.input.groupId, {
      notAllowedMessage: 'You can only create schedules for your assigned groups',
    });
  }

  assertQuarterHour(nextStart, 'startTime');
  assertQuarterHour(nextEnd, 'endTime');
  const start = parseTimeToMinutes(nextStart);
  const end = parseTimeToMinutes(nextEnd);
  if (!(start < end)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'startTime must be before endTime' });
  }

  await assertNoConflict({
    classroomId: schedule.classroomId,
    dayOfWeek: nextDayOfWeek,
    startTime: nextStart,
    endTime: nextEnd,
    excludeId: params.input.id,
  });

  const updateValues: Partial<typeof schedules.$inferInsert> = {
    startAt: null,
    endAt: null,
    updatedAt: new Date(),
  };

  if (params.input.dayOfWeek !== undefined) {
    updateValues.dayOfWeek = params.input.dayOfWeek;
  }
  if (params.input.startTime !== undefined) {
    updateValues.startTime = params.input.startTime;
  }
  if (params.input.endTime !== undefined) {
    updateValues.endTime = params.input.endTime;
  }
  if (params.input.groupId !== undefined) {
    updateValues.groupId = params.input.groupId;
  }

  const [updated] = await openpathDb
    .update(schedules)
    .set(updateValues)
    .where(eq(schedules.id, params.input.id))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update schedule' });
  }

  await notifyOpenPathClassroomChanged(updated.classroomId);

  return updated;
}

export async function updateOneOffScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  input: OneOffScheduleUpdateInput;
}): Promise<DbSchedule> {
  const schedule = await loadScheduleOrThrow(params.input.id);
  const oneOffBase = getOneOffScheduleBase(schedule);

  await assertOrgClassroomAccess(params.ctx.organizationId!, schedule.classroomId);
  assertCanManageSchedule(params.ctx, schedule);

  const nextGroupId = params.input.groupId ?? schedule.groupId;
  await assertOrgGroupAccess(params.ctx.organizationId!, nextGroupId);

  if (params.input.groupId !== undefined && params.input.groupId !== schedule.groupId) {
    await assertCanUseGroup(params.ctx, params.input.groupId, {
      notAllowedMessage: 'You can only create schedules for your assigned groups',
    });
  }

  const nextStartAt = params.input.startAt
    ? parseIsoDate(params.input.startAt, 'startAt')
    : oneOffBase.startAt;
  const nextEndAt = params.input.endAt
    ? parseIsoDate(params.input.endAt, 'endAt')
    : oneOffBase.endAt;

  assertQuarterHourInstant(nextStartAt, 'startAt');
  assertQuarterHourInstant(nextEndAt, 'endAt');
  if (!(nextStartAt.getTime() < nextEndAt.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'endAt must be after startAt' });
  }

  await assertNoOneOffConflict({
    classroomId: schedule.classroomId,
    startAt: nextStartAt,
    endAt: nextEndAt,
    excludeId: params.input.id,
  });

  const updateValues: Partial<typeof schedules.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (params.input.groupId !== undefined) {
    updateValues.groupId = params.input.groupId;
  }
  if (params.input.startAt !== undefined) {
    updateValues.startAt = nextStartAt;
  }
  if (params.input.endAt !== undefined) {
    updateValues.endAt = nextEndAt;
  }

  const [updated] = await openpathDb
    .update(schedules)
    .set(updateValues)
    .where(eq(schedules.id, params.input.id))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update schedule' });
  }

  await notifyOpenPathClassroomChanged(updated.classroomId);

  return updated;
}

export async function deleteScheduleForTenant(params: {
  ctx: ScheduleWriteContext;
  id: string;
}): Promise<void> {
  const schedule = await loadScheduleOrThrow(params.id);

  await assertOrgClassroomAccess(params.ctx.organizationId!, schedule.classroomId);
  assertCanManageSchedule(params.ctx, schedule);

  await openpathDb.delete(schedules).where(eq(schedules.id, params.id));
  await notifyOpenPathClassroomChanged(schedule.classroomId);
}
