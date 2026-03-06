import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantProcedure } from '../trpc.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  openpathDb,
  notifyOpenPathClassroomChanged,
  classrooms,
  machines,
  machineExemptions,
} from '../../db/openpath.js';

import { resolveActiveScheduleExpiresAt } from '../../services/current-group.service.js';

import { scopedClassroomNameForOrg } from '../../services/classroom-name.service.js';
import {
  getTenantClassroomById,
  listActiveClassroomExemptions,
  listTenantClassroomMachines,
  listTenantClassrooms,
  presentTenantClassroom,
} from '../../services/classroom-access.service.js';

import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  getOrgClassroomLinkOrThrow,
  requireTeacherOrAdmin,
} from '../../lib/tenant-access.js';
import { throwConflictOnUniqueViolation } from '../../lib/pg-errors.js';

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
  list: tenantProcedure.query(async ({ ctx }) =>
    listTenantClassrooms({ organizationId: ctx.organizationId! })
  ),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertOrgClassroomAccess(ctx.organizationId!, input.id);
    return getTenantClassroomById({ classroomId: input.id });
  }),

  listMachines: tenantProcedure
    .input(z.object({ classroomId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      return listTenantClassroomMachines({
        organizationId: ctx.organizationId!,
        classroomId: input.classroomId,
      });
    }),

  listExemptions: tenantProcedure
    .input(z.object({ classroomId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);
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
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      const machineRow = await openpathDb
        .select({ id: machines.id, classroomId: machines.classroomId, hostname: machines.hostname })
        .from(machines)
        .where(eq(machines.id, input.machineId))
        .limit(1);

      const machine = machineRow[0];
      if (!machine || machine.classroomId !== input.classroomId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' });
      }

      const now = new Date();

      const expiresAt = await resolveActiveScheduleExpiresAt({
        classroomId: input.classroomId,
        scheduleId: input.scheduleId,
        now,
      });

      const id = `exempt_${nanoid(10)}`;
      const inserted = await openpathDb
        .insert(machineExemptions)
        .values({
          id,
          machineId: input.machineId,
          classroomId: input.classroomId,
          scheduleId: input.scheduleId,
          createdBy: ctx.user.sub,
          expiresAt,
        })
        .onConflictDoNothing({
          target: [
            machineExemptions.machineId,
            machineExemptions.scheduleId,
            machineExemptions.expiresAt,
          ],
        })
        .returning();

      const created = inserted[0];
      const row =
        created ??
        (
          await openpathDb
            .select()
            .from(machineExemptions)
            .where(
              and(
                eq(machineExemptions.machineId, input.machineId),
                eq(machineExemptions.scheduleId, input.scheduleId),
                eq(machineExemptions.expiresAt, expiresAt)
              )
            )
            .limit(1)
        )[0];

      if (!row) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Could not create exemption' });
      }

      await notifyOpenPathClassroomChanged(input.classroomId);

      return {
        id: row.id,
        machineId: row.machineId,
        classroomId: row.classroomId,
        scheduleId: row.scheduleId,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        expiresAt: row.expiresAt.toISOString(),
      };
    }),

  deleteExemption: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      const existing = await openpathDb
        .select({ id: machineExemptions.id, classroomId: machineExemptions.classroomId })
        .from(machineExemptions)
        .where(eq(machineExemptions.id, input.id))
        .limit(1);

      const row = existing[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exemption not found' });
      }

      await assertOrgClassroomAccess(ctx.organizationId!, row.classroomId);

      await openpathDb.delete(machineExemptions).where(eq(machineExemptions.id, input.id));

      await notifyOpenPathClassroomChanged(row.classroomId);
      return { success: true };
    }),

  setActiveGroup: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);
      await assertOrgClassroomAccess(ctx.organizationId!, input.id);

      // Verify groupId belongs to the org (skip if null to deactivate group)
      if (input.groupId !== null) {
        await assertOrgGroupAccess(ctx.organizationId!, input.groupId);

        await assertCanUseGroup(ctx, input.groupId);
      }

      const [updated] = await openpathDb
        .update(classrooms)
        .set({ activeGroupId: input.groupId })
        .where(eq(classrooms.id, input.id))
        .returning();

      await notifyOpenPathClassroomChanged(updated.id);
      return presentTenantClassroom({ classroom: updated });
    }),

  deleteMachine: tenantProcedure
    .input(z.object({ id: z.string(), classroomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireTeacherOrAdmin(ctx);

      await assertOrgClassroomAccess(ctx.organizationId!, input.classroomId);

      await openpathDb
        .delete(machines)
        .where(and(eq(machines.id, input.id), eq(machines.classroomId, input.classroomId)));

      return { success: true };
    }),

  create: tenantProcedure.input(CreateClassroomSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const publicName = input.name.trim();
    const displayName = input.displayName?.trim() || publicName;

    if (!publicName) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom name is required' });
    }

    const classroomId = nanoid();
    const scopedName = scopedClassroomNameForOrg(ctx.organizationId!, publicName);

    if (input.defaultGroupId !== undefined) {
      await assertOrgGroupAccess(ctx.organizationId!, input.defaultGroupId);
      await assertCanUseGroup(ctx, input.defaultGroupId);
    }

    let classroom;
    try {
      [classroom] = await openpathDb
        .insert(classrooms)
        .values({
          id: classroomId,
          name: scopedName,
          displayName,
          defaultGroupId: input.defaultGroupId,
        })
        .returning();
    } catch (err: unknown) {
      throwConflictOnUniqueViolation(
        err,
        'Classroom with this name already exists in your organization'
      );
    }

    await db.insert(schema.cpOrganizationClassrooms).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      classroomId: classroom.id,
    });

    return presentTenantClassroom({ classroom });
  }),

  update: tenantProcedure.input(UpdateClassroomSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    await assertOrgClassroomAccess(ctx.organizationId!, input.id);

    if (input.defaultGroupId !== undefined) {
      await assertOrgGroupAccess(ctx.organizationId!, input.defaultGroupId);
      await assertCanUseGroup(ctx, input.defaultGroupId);
    }

    const { id, ...updateData } = input;
    const [updated] = await openpathDb
      .update(classrooms)
      .set(updateData)
      .where(eq(classrooms.id, id))
      .returning();

    if (input.defaultGroupId !== undefined) {
      await notifyOpenPathClassroomChanged(updated.id);
    }

    return presentTenantClassroom({ classroom: updated });
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const orgClassroom = await getOrgClassroomLinkOrThrow(ctx.organizationId!, input.id);

    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom.id));

    await openpathDb.delete(classrooms).where(eq(classrooms.id, input.id));

    return { success: true };
  }),
});
