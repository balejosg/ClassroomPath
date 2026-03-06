import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import {
  openpathDb,
  schedules,
  classrooms,
  notifyOpenPathClassroomChanged,
} from '../../db/openpath.js';

import { parseTimeToMinutes } from '../../services/schedule-time.js';
import {
  assertNoConflict,
  assertNoOneOffConflict,
  assertQuarterHour,
  assertQuarterHourInstant,
  deleteScheduleForTenant,
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  parseIsoDate,
  type DbSchedule,
  updateOneOffScheduleForTenant,
  updateWeeklyScheduleForTenant,
  weeklyRecurrenceWhereClause,
} from '../../services/schedule-write.service.js';

import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  isOrgAdmin,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';
import { getOrgClassroomIds } from '../../services/org-classroom-membership.service.js';
import {
  loadScheduleMetadataMaps,
  presentOneOffScheduleWithPermissions,
  presentWeeklySchedule,
  presentWeeklyScheduleWithPermissions,
} from '../../services/schedule-presenter.js';

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
      const metadata = await loadScheduleMetadataMaps([...rows, ...oneOffRows]);

      return {
        classroom: {
          id: classroom[0].id,
          name: classroom[0].name,
          displayName: classroom[0].displayName,
        },
        schedules: rows.map((row) =>
          presentWeeklyScheduleWithPermissions(row, metadata, { userId, admin })
        ),
        oneOffSchedules: oneOffRows.map((row) =>
          presentOneOffScheduleWithPermissions(row, metadata, { userId, admin })
        ),
      };
    }),

  getMine: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);

    const classroomIds = await getOrgClassroomIds({ organizationId: ctx.organizationId! });
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

    const metadata = await loadScheduleMetadataMaps(rows);

    return rows.map((row) => presentWeeklySchedule(row, metadata));
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

    const updated = await updateWeeklyScheduleForTenant({ ctx, input });
    return mapToWeeklyScheduleBase(updated);
  }),

  updateOneOff: tenantProcedure
    .input(UpdateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const updated = await updateOneOffScheduleForTenant({ ctx, input });
      return mapToOneOffScheduleBase(updated);
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      await deleteScheduleForTenant({ ctx, id: input.id });
      return { success: true };
    }),
});
