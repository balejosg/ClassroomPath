// @ts-nocheck
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

import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';

function normalizeTime(t: string): string {
  const parts = t.split(':');
  const hh = parts[0];
  const mm = parts[1];
  if (hh !== undefined && mm !== undefined) return `${hh}:${mm}`;
  return t;
}

function weeklyRecurrenceWhereClause() {
  return or(eq(schedules.recurrence, 'weekly'), isNull(schedules.recurrence));
}

function parseTimeToMinutes(t: string): number {
  const [hh, mm] = t.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return NaN;
  return h * 60 + m;
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

  const clauses: any[] = [
    eq(schedules.classroomId, classroomId),
    eq(schedules.recurrence, 'one_off'),
    sql`${schedules.startAt} < ${endAt} AND ${schedules.endAt} > ${startAt}`,
  ];

  if (excludeId) {
    clauses.push(sql`${schedules.id} != ${excludeId}::uuid`);
  }

  const conflicts = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(...clauses))
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

  const clauses: any[] = [
    eq(schedules.classroomId, classroomId),
    eq(schedules.dayOfWeek, dayOfWeek),
    sql`(${startTime}::time, ${endTime}::time) OVERLAPS (${schedules.startTime}, ${schedules.endTime})`,
  ];

  if (excludeId) {
    clauses.push(sql`${schedules.id} != ${excludeId}::uuid`);
  }

  const conflicts = await openpathDb
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(...clauses))
    .limit(1);

  if (conflicts.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ese tramo horario ya esta reservado',
    });
  }
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
  id: z.string().min(1),
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
  id: z.string().min(1),
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

      const rows = await openpathDb
        .select()
        .from(schedules)
        .where(and(eq(schedules.classroomId, input.classroomId), weeklyRecurrenceWhereClause()))
        .orderBy(schedules.dayOfWeek, schedules.startTime);

      const oneOffRows = await openpathDb
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
        schedules: rows.map((s: any) => ({
          id: s.id,
          classroomId: s.classroomId,
          dayOfWeek: s.dayOfWeek,
          startTime: normalizeTime(s.startTime),
          endTime: normalizeTime(s.endTime),
          groupId: s.groupId,
          teacherId: s.teacherId,
          recurrence: s.recurrence ?? 'weekly',
          createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updatedAt: s.updatedAt?.toISOString?.() ?? undefined,
          isMine: s.teacherId === userId,
          canEdit: s.teacherId === userId || admin,
        })),
        oneOffSchedules: oneOffRows.map((s: any) => ({
          id: s.id,
          classroomId: s.classroomId,
          startAt: s.startAt?.toISOString?.() ?? null,
          endAt: s.endAt?.toISOString?.() ?? null,
          groupId: s.groupId,
          teacherId: s.teacherId,
          recurrence: 'one_off',
          createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updatedAt: s.updatedAt?.toISOString?.() ?? undefined,
          isMine: s.teacherId === userId,
          canEdit: s.teacherId === userId || admin,
        })),
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

    const rows = await openpathDb
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

    return rows.map((s: any) => ({
      id: s.id,
      classroomId: s.classroomId,
      dayOfWeek: s.dayOfWeek,
      startTime: normalizeTime(s.startTime),
      endTime: normalizeTime(s.endTime),
      groupId: s.groupId,
      teacherId: s.teacherId,
      recurrence: s.recurrence ?? 'weekly',
      createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: s.updatedAt?.toISOString?.() ?? undefined,
    }));
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
        startTime: input.startTime as any,
        endTime: input.endTime as any,
        startAt: null,
        endAt: null,
        recurrence: 'weekly',
      } as any)
      .returning();

    await notifyOpenPathClassroomChanged(created.classroomId);

    return {
      id: created.id,
      classroomId: created.classroomId,
      dayOfWeek: created.dayOfWeek,
      startTime: normalizeTime(created.startTime),
      endTime: normalizeTime(created.endTime),
      groupId: created.groupId,
      teacherId: created.teacherId,
      recurrence: created.recurrence ?? 'weekly',
      createdAt: created.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: created.updatedAt?.toISOString?.() ?? undefined,
    };
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
          startAt: startAt as any,
          endAt: endAt as any,
          recurrence: 'one_off',
        } as any)
        .returning();

      await notifyOpenPathClassroomChanged(created.classroomId);

      return {
        id: created.id,
        classroomId: created.classroomId,
        startAt: created.startAt?.toISOString?.() ?? null,
        endAt: created.endAt?.toISOString?.() ?? null,
        groupId: created.groupId,
        teacherId: created.teacherId,
        recurrence: 'one_off',
        createdAt: created.createdAt?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: created.updatedAt?.toISOString?.() ?? undefined,
      };
    }),

  update: tenantProcedure.input(UpdateScheduleSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);

    const existing = await openpathDb
      .select()
      .from(schedules)
      .where(eq(schedules.id, input.id as any))
      .limit(1);

    if (!existing[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
    }

    await assertOrgClassroomAccess(ctx.organizationId!, existing[0].classroomId);

    const admin = isOrgAdmin(ctx);
    const isOwner = existing[0].teacherId === ctx.user.sub;
    if (!admin && !isOwner) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only manage your own schedules' });
    }

    const nextDayOfWeek = input.dayOfWeek ?? existing[0].dayOfWeek;
    const nextStart = input.startTime ?? normalizeTime(existing[0].startTime);
    const nextEnd = input.endTime ?? normalizeTime(existing[0].endTime);
    const nextGroupId = input.groupId ?? existing[0].groupId;

    await assertOrgGroupAccess(ctx.organizationId!, nextGroupId);

    if (input.groupId !== undefined && input.groupId !== existing[0].groupId) {
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
      classroomId: existing[0].classroomId,
      dayOfWeek: nextDayOfWeek,
      startTime: nextStart,
      endTime: nextEnd,
      excludeId: input.id,
    });

    const [updated] = await openpathDb
      .update(schedules)
      .set({
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime as any,
        endTime: input.endTime as any,
        groupId: input.groupId,
        startAt: null,
        endAt: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(schedules.id, input.id as any))
      .returning();

    await notifyOpenPathClassroomChanged(updated.classroomId);

    return {
      id: updated.id,
      classroomId: updated.classroomId,
      dayOfWeek: updated.dayOfWeek,
      startTime: normalizeTime(updated.startTime),
      endTime: normalizeTime(updated.endTime),
      groupId: updated.groupId,
      teacherId: updated.teacherId,
      recurrence: updated.recurrence ?? 'weekly',
      createdAt: updated.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: updated.updatedAt?.toISOString?.() ?? undefined,
    };
  }),

  updateOneOff: tenantProcedure
    .input(UpdateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.id, input.id as any))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      if (existing[0].recurrence !== 'one_off') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Schedule is not one-off' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, existing[0].classroomId);

      const admin = isOrgAdmin(ctx);
      const isOwner = existing[0].teacherId === ctx.user.sub;
      if (!admin && !isOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only manage your own schedules',
        });
      }

      const nextGroupId = input.groupId ?? existing[0].groupId;
      await assertOrgGroupAccess(ctx.organizationId!, nextGroupId);

      if (input.groupId !== undefined && input.groupId !== existing[0].groupId) {
        await assertCanUseGroup(ctx, input.groupId, {
          notAllowedMessage: 'You can only create schedules for your assigned groups',
        });
      }

      const baseStartAt = existing[0].startAt;
      const baseEndAt = existing[0].endAt;
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
        classroomId: existing[0].classroomId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeId: input.id,
      });

      const [updated] = await openpathDb
        .update(schedules)
        .set({
          groupId: input.groupId,
          startAt: input.startAt ? (nextStartAt as any) : undefined,
          endAt: input.endAt ? (nextEndAt as any) : undefined,
          updatedAt: new Date(),
        } as any)
        .where(eq(schedules.id, input.id as any))
        .returning();

      await notifyOpenPathClassroomChanged(updated.classroomId);

      return {
        id: updated.id,
        classroomId: updated.classroomId,
        startAt: updated.startAt?.toISOString?.() ?? null,
        endAt: updated.endAt?.toISOString?.() ?? null,
        groupId: updated.groupId,
        teacherId: updated.teacherId,
        recurrence: 'one_off',
        createdAt: updated.createdAt?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: updated.updatedAt?.toISOString?.() ?? undefined,
      };
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing = await openpathDb
        .select()
        .from(schedules)
        .where(eq(schedules.id, input.id as any))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, existing[0].classroomId);

      const admin = isOrgAdmin(ctx);
      const isOwner = existing[0].teacherId === ctx.user.sub;
      if (!admin && !isOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only manage your own schedules',
        });
      }

      await openpathDb.delete(schedules).where(eq(schedules.id, input.id as any));

      await notifyOpenPathClassroomChanged(existing[0].classroomId);
      return { success: true };
    }),
});
