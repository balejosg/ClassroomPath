import { z } from 'zod';

import { router, tenantProcedure } from '../trpc.js';
import {
  createOneOffScheduleForTenant,
  createWeeklyScheduleForTenant,
  deleteScheduleForTenant,
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  type DbSchedule,
  updateOneOffScheduleForTenant,
  updateWeeklyScheduleForTenant,
} from '../../services/schedule-write.service.js';
import {
  getClassroomSchedulesForTenant,
  getTeacherSchedulesForTenant,
} from '../../services/schedule-read.service.js';

import { requireTeacherOrAdmin } from '../../lib/tenant-access.js';

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
      return getClassroomSchedulesForTenant({ ctx, classroomId: input.classroomId });
    }),

  getMine: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);
    return getTeacherSchedulesForTenant({ ctx });
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
