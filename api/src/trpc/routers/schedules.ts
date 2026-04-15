import { z } from 'zod';

import { router, teacherOrAdminProcedure } from '../trpc.js';
import {
  createOneOffScheduleForTenant,
  createWeeklyScheduleForTenant,
  deleteScheduleForTenant,
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  type DbSchedule,
  updateOneOffScheduleForTenant,
  updateWeeklyScheduleForTenant,
} from '../../services/schedules/schedule-write.service.js';
import {
  getClassroomSchedulesForTenant,
  getTeacherSchedulesForTenant,
} from '../../services/schedules/schedule-read.service.js';

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
  getByClassroom: teacherOrAdminProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return getClassroomSchedulesForTenant({ ctx, classroomId: input.classroomId });
    }),

  getMine: teacherOrAdminProcedure.query(async ({ ctx }) => {
    return getTeacherSchedulesForTenant({ ctx });
  }),

  create: teacherOrAdminProcedure.input(CreateScheduleSchema).mutation(async ({ ctx, input }) => {
    const created = await createWeeklyScheduleForTenant({ ctx, input });

    return mapToWeeklyScheduleBase(created as DbSchedule);
  }),

  createOneOff: teacherOrAdminProcedure
    .input(CreateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await createOneOffScheduleForTenant({ ctx, input });

      return mapToOneOffScheduleBase(created as DbSchedule);
    }),

  update: teacherOrAdminProcedure.input(UpdateScheduleSchema).mutation(async ({ ctx, input }) => {
    const updated = await updateWeeklyScheduleForTenant({ ctx, input });
    return mapToWeeklyScheduleBase(updated);
  }),

  updateOneOff: teacherOrAdminProcedure
    .input(UpdateOneOffScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await updateOneOffScheduleForTenant({ ctx, input });
      return mapToOneOffScheduleBase(updated);
    }),

  delete: teacherOrAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await deleteScheduleForTenant({ ctx, id: input.id });
      return { success: true };
    }),
});
