import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import {
  getTenantClassroomById,
  listActiveClassroomExemptions,
  listTenantClassroomMachines,
  listTenantClassrooms,
} from '../../services/classrooms/classroom-access.service.js';
import {
  createClassroomExemptionForTenant,
  createClassroomForTenant,
  deleteClassroomExemptionForTenant,
  deleteClassroomForTenant,
  deleteClassroomMachineForTenant,
  setActiveGroupForTenant,
  updateClassroomForTenant,
} from '../../services/classrooms/classroom-write.service.js';

import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import {
  assertTeacherOrAdminTenantProcedureContext,
  assertTenantProcedureContext,
} from '../tenant-procedure-helpers.js';

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

export const classroomsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    assertTenantProcedureContext(ctx);
    return listTenantClassrooms({ organizationId: ctx.organizationId });
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    await assertOrgClassroomAccess(ctx.organizationId, input.id);
    return getTenantClassroomById({ classroomId: input.id });
  }),

  listMachines: tenantProcedure
    .input(z.object({ classroomId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      return listTenantClassroomMachines({
        organizationId: ctx.organizationId,
        classroomId: input.classroomId,
      });
    }),

  listExemptions: tenantProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      await assertOrgClassroomAccess(ctx.organizationId, input.classroomId);
      return listActiveClassroomExemptions({ classroomId: input.classroomId });
    }),

  createExemption: tenantProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
        classroomId: z.string().min(1),
        scheduleId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      return createClassroomExemptionForTenant({ ctx, input });
    }),

  deleteExemption: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      await deleteClassroomExemptionForTenant({ ctx, id: input.id });
      return { success: true };
    }),

  setActiveGroup: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      return setActiveGroupForTenant({ ctx, classroomId: input.id, groupId: input.groupId });
    }),

  deleteMachine: tenantProcedure
    .input(z.object({ id: z.string(), classroomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertTeacherOrAdminTenantProcedureContext(ctx);
      await deleteClassroomMachineForTenant({ ctx, input });
      return { success: true };
    }),

  create: tenantProcedure.input(CreateClassroomSchema).mutation(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return createClassroomForTenant({ ctx, input });
  }),

  update: tenantProcedure.input(UpdateClassroomSchema).mutation(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    return updateClassroomForTenant({ ctx, input });
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertTeacherOrAdminTenantProcedureContext(ctx);
    await deleteClassroomForTenant({ ctx, classroomId: input.id });
    return { success: true };
  }),
});
