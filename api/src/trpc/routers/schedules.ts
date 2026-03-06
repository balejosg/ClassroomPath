import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, schedules, classrooms } from '../../db/openpath.js';
import {
  createOneOffScheduleForTenant,
  createWeeklyScheduleForTenant,
  deleteScheduleForTenant,
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  type DbSchedule,
  updateOneOffScheduleForTenant,
  updateWeeklyScheduleForTenant,
  weeklyRecurrenceWhereClause,
} from '../../services/schedule-write.service.js';

import {
  assertOrgClassroomAccess,
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
    const created = await createWeeklyScheduleForTenant({ ctx, input });

    return mapToWeeklyScheduleBase(created as DbSchedule);
  }),

  createOneOff: tenantProcedure
    .input(CreateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      const created = await createOneOffScheduleForTenant({ ctx, input });

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
