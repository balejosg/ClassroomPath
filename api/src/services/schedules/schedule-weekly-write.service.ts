import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { notifyOpenPathClassroomChanged, openpathDb, schedules } from '../../db/openpath.js';
import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
} from '../../lib/tenant-access.js';
import {
  assertCanManageSchedule,
  assertNoConflict,
  assertQuarterHour,
  getWeeklyScheduleBase,
  loadScheduleOrThrow,
  type DbSchedule,
  type ScheduleWriteContext,
} from './schedule-write-shared.service.js';
import { parseTimeToMinutes } from './schedule-time.js';

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
