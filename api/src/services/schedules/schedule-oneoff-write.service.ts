import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { openpathDb, schedules } from '../../db/openpath.js';
import { notifyOpenPathClassroomChanged } from '../../db/openpath-repos/publish.js';
import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
} from '../../lib/tenant-access.js';
import {
  assertCanManageSchedule,
  assertNoOneOffConflict,
  assertQuarterHourInstant,
  getOneOffScheduleBase,
  loadScheduleOrThrow,
  parseIsoDate,
  type DbSchedule,
  type ScheduleWriteContext,
} from './schedule-write-shared.service.js';

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
