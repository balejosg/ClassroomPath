import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  openpathDb,
  schedules,
  classrooms,
  notifyOpenPathClassroomChanged,
} from '../../db/openpath.js';

import { normalizeTimeHHMM, parseTimeToMinutes } from '../../services/schedule-time.js';

import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';

function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

function assertQuarterHour(t: string, field: string): void {
  const minutes = parseTimeToMinutes(t);
  if (!Number.isFinite(minutes)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid time` });
  }
  const m = minutes % 60;
  if (m % 15 !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in 15-minute increments`,
    });
  }
}

function parseIsoDate(value: string, field: string): Date {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid date` });
  }
  return d;
}

function assertQuarterHourInstant(d: Date, field: string): void {
  if (d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must not include seconds` });
  }
  if (d.getUTCMinutes() % 15 !== 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${field} must be in 15-minute increments`,
    });
  }
}

async function assertNoOneOffConflict(params: {
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

  if (conflicts.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ese tramo horario ya esta reservado',
    });
  }
}

async function assertNoConflict(params: {
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

  if (conflicts.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ese tramo horario ya esta reservado',
    });
  }
}

type DbSchedule = typeof schedules.$inferSelect;

function mapToWeeklyScheduleBase(s: DbSchedule) {
  if (s.dayOfWeek === null || s.startTime === null || s.endTime === null) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Invalid weekly schedule row' });
  }

  return {
    id: s.id,
    classroomId: s.classroomId,
    dayOfWeek: s.dayOfWeek,
    startTime: normalizeTimeHHMM(s.startTime),
    endTime: normalizeTimeHHMM(s.endTime),
    groupId: s.groupId,
    teacherId: s.teacherId,
    recurrence: s.recurrence ?? 'weekly',
    createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: s.updatedAt?.toISOString?.() ?? undefined,
  };
}

function mapToOneOffScheduleBase(s: DbSchedule) {
  return {
    id: s.id,
    classroomId: s.classroomId,
    startAt: s.startAt?.toISOString?.() ?? null,
    endAt: s.endAt?.toISOString?.() ?? null,
    groupId: s.groupId,
    teacherId: s.teacherId,
    recurrence: 'one_off' as const,
    createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: s.updatedAt?.toISOString?.() ?? undefined,
  };
}

const CreateScheduleSchema = z.object({
  classroomId: z.string().min(1),
  groupId: z.string().min(1),
  dayOfWeek: z.number().int().min(1).max(5),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
});

const CreateOneOffScheduleSchema = z.object({
  classroomId: z.string().min(1),
  groupId: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
});

const UpdateScheduleSchema = z.object({
  id: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(5).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  groupId: z.string().min(1).optional(),
});

const UpdateOneOffScheduleSchema = z.object({
  id: z.string().uuid(),
  startAt: z.string().min(1).optional(),
  endAt: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
});

export const schedulesRouter = router({
  getByClassroom: tenantProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      const classroom = await openpathDb
        .select()
        .from(classrooms)
        .where(eq(classrooms.id, input.classroomId))
        .limit(1);

      if (!classroom[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
      }

      const rows: DbSchedule[] = await openpathDb
        .select()
        .from(schedules)
        .where(and(eq(schedules.classroomId, input.classroomId), weeklyRecurrenceWhereClause()))
        .orderBy(schedules.dayOfWeek, schedules.startTime);

      const oneOffRows: DbSchedule[] = await openpathDb
        .select()
        .from(schedules)
        .where(
          and(eq(schedules.classroomId, input.classroomId), eq(schedules.recurrence, 'one_off'))
        )
        .orderBy(schedules.startAt);

      const userId = ctx.user.sub;
      const admin = isOrgAdmin(ctx);

      return {
        classroom: {
          id: classroom[0].id,
          name: classroom[0].name,
          displayName: classroom[0].displayName,
        },
        schedules: rows.map((s) => {
          const base = mapToWeeklyScheduleBase(s);
          const isMine = base.teacherId === userId;
          return { ...base, isMine, canEdit: isMine || admin };
        }),
        oneOffSchedules: oneOffRows.map((s) => {
          const base = mapToOneOffScheduleBase(s);
          const isMine = base.teacherId === userId;
          return { ...base, isMine, canEdit: isMine || admin };
        }),
      };
    }),

  getMine: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);

    const orgClassrooms = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

    const classroomIds = orgClassrooms.map((oc) => oc.classroomId);
    if (classroomIds.length === 0) return [];

    const rows: DbSchedule[] = await openpathDb
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.teacherId, ctx.user.sub),
          inArray(schedules.classroomId, classroomIds),
          weeklyRecurrenceWhereClause()
        )
      )
      .orderBy(schedules.dayOfWeek, schedules.startTime);

    return rows.map(mapToWeeklyScheduleBase);
  }),

  create: tenantProcedure.input(CreateScheduleSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);
    await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

    await assertCanUseGroup(ctx, input.groupId, {
      notAllowedMessage: 'You can only create schedules for your assigned groups',
    });

    assertQuarterHour(input.startTime, 'startTime');
    assertQuarterHour(input.endTime, 'endTime');
    const start = parseTimeToMinutes(input.startTime);
    const end = parseTimeToMinutes(input.endTime);
    if (!(start < end)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'startTime must be before endTime' });
    }

    await assertNoConflict({
      classroomId: input.classroomId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    const [created] = await openpathDb
      .insert(schedules)
      .values({
        classroomId: input.classroomId,
        teacherId: ctx.user.sub,
        groupId: input.groupId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        startAt: null,
        endAt: null,
        recurrence: 'weekly',
      })
      .returning();

    await notifyOpenPathClassroomChanged(created.classroomId);

    return mapToWeeklyScheduleBase(created as DbSchedule);
  }),

  createOneOff: tenantProcedure
    .input(CreateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);
      await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

      await assertCanUseGroup(ctx, input.groupId, {
        notAllowedMessage: 'You can only create schedules for your assigned groups',
      });

      const startAt = parseIsoDate(input.startAt, 'startAt');
      const endAt = parseIsoDate(input.endAt, 'endAt');

      assertQuarterHourInstant(startAt, 'startAt');
      assertQuarterHourInstant(endAt, 'endAt');
      if (!(startAt.getTime() < endAt.getTime())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'endAt must be after startAt' });
      }

      await assertNoOneOffConflict({
        classroomId: input.classroomId,
        startAt,
        endAt,
      });

      const [created] = await openpathDb
        .insert(schedules)
        .values({
          classroomId: input.classroomId,
          teacherId: ctx.user.sub,
          groupId: input.groupId,
          dayOfWeek: null,
          startTime: null,
          endTime: null,
          startAt,
          endAt,
          recurrence: 'one_off',
        })
        .returning();

      await notifyOpenPathClassroomChanged(created.classroomId);

      return mapToOneOffScheduleBase(created as DbSchedule);
    }),

  update: tenantProcedure.input(UpdateScheduleSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    const existing: DbSchedule[] = await openpathDb
      .select()
      .from(schedules)
      .where(eq(schedules.id, input.id))
      .limit(1);

    const schedule = existing[0];
    if (!schedule) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
    }

    if (schedule.recurrence === 'one_off') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not weekly' });
    }

    const baseDayOfWeek = schedule.dayOfWeek;
    const baseStartTime = schedule.startTime;
    const baseEndTime = schedule.endTime;

    if (baseDayOfWeek === null || baseStartTime === null || baseEndTime === null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid weekly schedule' });
    }

    await assertOrgClassroomAccess(ctx.organizationId!, schedule.classroomId);

    const admin = isOrgAdmin(ctx);
    const isOwner = schedule.teacherId === ctx.user.sub;
    if (!admin && !isOwner) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only manage your own schedules' });
    }

    const nextDayOfWeek = input.dayOfWeek ?? baseDayOfWeek;
    const nextStart = input.startTime ?? normalizeTimeHHMM(baseStartTime);
    const nextEnd = input.endTime ?? normalizeTimeHHMM(baseEndTime);
    const nextGroupId = input.groupId ?? schedule.groupId;

    await assertOrgGroupAccess(ctx.organizationId!, nextGroupId);

    if (input.groupId !== undefined && input.groupId !== schedule.groupId) {
      await assertCanUseGroup(ctx, input.groupId, {
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
      excludeId: input.id,
    });

    const updateValues: Partial<typeof schedules.$inferInsert> = {
      startAt: null,
      endAt: null,
      updatedAt: new Date(),
    };

    if (input.dayOfWeek !== undefined) {
      updateValues.dayOfWeek = input.dayOfWeek;
    }
    if (input.startTime !== undefined) {
      updateValues.startTime = input.startTime;
    }
    if (input.endTime !== undefined) {
      updateValues.endTime = input.endTime;
    }
    if (input.groupId !== undefined) {
      updateValues.groupId = input.groupId;
    }

    const [updated] = await openpathDb
      .update(schedules)
      .set(updateValues)
      .where(eq(schedules.id, input.id))
      .returning();

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update schedule' });
    }

    await notifyOpenPathClassroomChanged(updated.classroomId);

    return mapToWeeklyScheduleBase(updated as DbSchedule);
  }),

  updateOneOff: tenantProcedure
    .input(UpdateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing: DbSchedule[] = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.id, input.id))
        .limit(1);

      const schedule = existing[0];
      if (!schedule) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      if (schedule.recurrence !== 'one_off') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not one-off' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, schedule.classroomId);

      const admin = isOrgAdmin(ctx);
      const isOwner = schedule.teacherId === ctx.user.sub;
      if (!admin && !isOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only manage your own schedules',
        });
      }

      const nextGroupId = input.groupId ?? schedule.groupId;
      await assertOrgGroupAccess(ctx.organizationId!, nextGroupId);

      if (input.groupId !== undefined && input.groupId !== schedule.groupId) {
        await assertCanUseGroup(ctx, input.groupId, {
          notAllowedMessage: 'You can only create schedules for your assigned groups',
        });
      }

      const baseStartAt = schedule.startAt;
      const baseEndAt = schedule.endAt;
      if (!baseStartAt || !baseEndAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid one-off schedule' });
      }

      const nextStartAt = input.startAt ? parseIsoDate(input.startAt, 'startAt') : baseStartAt;
      const nextEndAt = input.endAt ? parseIsoDate(input.endAt, 'endAt') : baseEndAt;

      assertQuarterHourInstant(nextStartAt, 'startAt');
      assertQuarterHourInstant(nextEndAt, 'endAt');
      if (!(nextStartAt.getTime() < nextEndAt.getTime())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'endAt must be after startAt' });
      }

      await assertNoOneOffConflict({
        classroomId: schedule.classroomId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeId: input.id,
      });

      const updateValues: Partial<typeof schedules.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.groupId !== undefined) {
        updateValues.groupId = input.groupId;
      }
      if (input.startAt !== undefined) {
        updateValues.startAt = nextStartAt;
      }
      if (input.endAt !== undefined) {
        updateValues.endAt = nextEndAt;
      }

      const [updated] = await openpathDb
        .update(schedules)
        .set(updateValues)
        .where(eq(schedules.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update schedule',
        });
      }

      await notifyOpenPathClassroomChanged(updated.classroomId);

      return mapToOneOffScheduleBase(updated as DbSchedule);
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing: DbSchedule[] = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.id, input.id))
        .limit(1);

      const schedule = existing[0];
      if (!schedule) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, schedule.classroomId);

      const admin = isOrgAdmin(ctx);
      const isOwner = schedule.teacherId === ctx.user.sub;
      if (!admin && !isOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only manage your own schedules',
        });
      }

      await openpathDb.delete(schedules).where(eq(schedules.id, input.id));

      await notifyOpenPathClassroomChanged(schedule.classroomId);
      return { success: true };
    }),
});
