import { z } from 'zod';
import {
  router,
  teacherOrAdminProcedure,
  tenantAdminProcedure,
  tenantMemberProcedure,
} from '../trpc.js';
import {
  getTenantClassroomById,
  listActiveClassroomExemptions,
  listTenantClassroomMachines,
  listTenantClassrooms,
} from '../../services/classrooms/classroom-access.service.js';
import {
  createClassroomExemptionForTenant,
  createOperationalClassroomExemptionForTenant,
  createClassroomForTenant,
  deleteClassroomExemptionForTenant,
  deleteClassroomForTenant,
  deleteClassroomMachineForTenant,
  setActiveGroupForTenant,
  updateClassroomForTenant,
} from '../../services/classrooms/classroom-write.service.js';

import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';

const CreateClassroomSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
});

const UpdateClassroomSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
});

const CreateOperationalExemptionSchema = z.object({
  machineId: z.string().min(1),
  classroomId: z.string().min(1),
  durationHours: z.number().int().min(1).max(24),
  reason: z.string().trim().min(3).max(500),
});

export const classroomsRouter = router({
  list: tenantMemberProcedure.query(async ({ ctx }) => {
    return listTenantClassrooms({ organizationId: ctx.organizationId });
  }),

  getById: tenantMemberProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgClassroomAccess(ctx.organizationId, input.id);
      return getTenantClassroomById({ classroomId: input.id });
    }),

  listMachines: teacherOrAdminProcedure
    .input(z.object({ classroomId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return listTenantClassroomMachines({
        organizationId: ctx.organizationId,
        classroomId: input.classroomId,
      });
    }),

  listExemptions: teacherOrAdminProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertOrgClassroomAccess(ctx.organizationId, input.classroomId);
      return listActiveClassroomExemptions({ classroomId: input.classroomId });
    }),

  createExemption: teacherOrAdminProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
        classroomId: z.string().min(1),
        scheduleId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createClassroomExemptionForTenant({ ctx, input });
    }),

  createOperationalExemption: tenantAdminProcedure
    .input(CreateOperationalExemptionSchema)
    .mutation(async ({ ctx, input }) => {
      return createOperationalClassroomExemptionForTenant({ ctx, input });
    }),

  deleteExemption: teacherOrAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await deleteClassroomExemptionForTenant({ ctx, id: input.id });
      return { success: true };
    }),

  setActiveGroup: teacherOrAdminProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      return setActiveGroupForTenant({ ctx, classroomId: input.id, groupId: input.groupId });
    }),

  deleteMachine: teacherOrAdminProcedure
    .input(z.object({ id: z.string(), classroomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteClassroomMachineForTenant({ ctx, input });
      return { success: true };
    }),

  create: teacherOrAdminProcedure.input(CreateClassroomSchema).mutation(async ({ ctx, input }) => {
    return createClassroomForTenant({ ctx, input });
  }),

  update: teacherOrAdminProcedure.input(UpdateClassroomSchema).mutation(async ({ ctx, input }) => {
    return updateClassroomForTenant({ ctx, input });
  }),

  delete: teacherOrAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteClassroomForTenant({ ctx, classroomId: input.id });
      return { success: true };
    }),
});
