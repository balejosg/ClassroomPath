// @ts-nocheck
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { classrooms, machines, schedules } from '../../db/openpath.js';

async function getCurrentScheduleGroupId(params: {
  classroomId: string;
  date?: Date | undefined;
}): Promise<string | null> {
  const date = params.date ?? new Date();
  const dayOfWeek = date.getDay();

  // Only Mon-Fri scheduling is supported
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const currentTime = date.toTimeString().slice(0, 5);

  const rows = await openpathDb
    .select({ groupId: schedules.groupId })
    .from(schedules)
    .where(
      and(
        eq(schedules.classroomId, params.classroomId),
        eq(schedules.dayOfWeek, dayOfWeek),
        sql`${schedules.startTime} <= ${currentTime}::time`,
        sql`${schedules.endTime} > ${currentTime}::time`
      )
    )
    .limit(1);

  return rows[0]?.groupId ?? null;
}

const CreateClassroomSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
});

const UpdateClassroomSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  defaultGroupId: z.string().optional(),
  activeGroupId: z.string().optional(),
});

export const classroomsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const orgClassrooms = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

    const classroomIds = orgClassrooms.map((oc) => oc.classroomId);

    if (classroomIds.length === 0) return [];

    const result = await openpathDb
      .select()
      .from(classrooms)
      .where(inArray(classrooms.id, classroomIds));

    const now = new Date();
    const nowDayOfWeek = now.getDay();
    const nowTime = now.toTimeString().slice(0, 5);

    const scheduleGroupByClassroomId = new Map<string, string>();
    if (nowDayOfWeek !== 0 && nowDayOfWeek !== 6) {
      const activeScheduleRows = await openpathDb
        .select({ classroomId: schedules.classroomId, groupId: schedules.groupId })
        .from(schedules)
        .where(
          and(
            inArray(schedules.classroomId, classroomIds),
            eq(schedules.dayOfWeek, nowDayOfWeek),
            sql`${schedules.startTime} <= ${nowTime}::time`,
            sql`${schedules.endTime} > ${nowTime}::time`
          )
        );

      for (const row of activeScheduleRows) {
        if (!scheduleGroupByClassroomId.has(row.classroomId)) {
          scheduleGroupByClassroomId.set(row.classroomId, row.groupId);
        }
      }
    }

    // Serialize Date fields for JSON compatibility
    return result.map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      defaultGroupId: c.defaultGroupId,
      activeGroupId: c.activeGroupId,
      currentGroupId: c.activeGroupId ?? scheduleGroupByClassroomId.get(c.id) ?? c.defaultGroupId,
      createdAt: c.createdAt?.toISOString() ?? null,
      updatedAt: c.updatedAt?.toISOString() ?? null,
    }));
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    const classroom = await openpathDb
      .select()
      .from(classrooms)
      .where(eq(classrooms.id, input.id))
      .limit(1);

    if (!classroom[0]) return null;

    const c = classroom[0];
    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: c.id });

    // Serialize Date fields for JSON compatibility
    return {
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      defaultGroupId: c.defaultGroupId,
      activeGroupId: c.activeGroupId,
      currentGroupId: c.activeGroupId ?? currentScheduleGroupId ?? c.defaultGroupId,
      createdAt: c.createdAt?.toISOString() ?? null,
      updatedAt: c.updatedAt?.toISOString() ?? null,
    };
  }),

  listMachines: tenantProcedure
    .input(z.object({ classroomId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Get all classrooms for this organization
      const orgClassrooms = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

      const classroomIds = orgClassrooms.map((oc) => oc.classroomId);

      if (classroomIds.length === 0) return [];

      // If specific classroom requested, verify access
      if (input.classroomId) {
        if (!classroomIds.includes(input.classroomId)) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Classroom not found or access denied',
          });
        }

        // Return machines for specific classroom
        const result = await openpathDb
          .select()
          .from(machines)
          .where(eq(machines.classroomId, input.classroomId));

        return result.map((m) => ({
          id: m.id,
          hostname: m.hostname,
          classroomId: m.classroomId,
          version: m.version,
          lastSeen: m.lastSeen?.toISOString() ?? null,
          downloadTokenHash: m.downloadTokenHash,
          downloadTokenLastRotatedAt: m.downloadTokenLastRotatedAt?.toISOString() ?? null,
          createdAt: m.createdAt?.toISOString() ?? null,
          updatedAt: m.updatedAt?.toISOString() ?? null,
        }));
      }

      // Return machines for all organization's classrooms
      const result = await openpathDb
        .select()
        .from(machines)
        .where(inArray(machines.classroomId, classroomIds));

      // Explicitly serialize Date fields for JSON compatibility
      return result.map((m) => ({
        id: m.id,
        hostname: m.hostname,
        classroomId: m.classroomId,
        version: m.version,
        lastSeen: m.lastSeen?.toISOString() ?? null,
        downloadTokenHash: m.downloadTokenHash,
        downloadTokenLastRotatedAt: m.downloadTokenLastRotatedAt?.toISOString() ?? null,
        createdAt: m.createdAt?.toISOString() ?? null,
        updatedAt: m.updatedAt?.toISOString() ?? null,
      }));
    }),

  setActiveGroup: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const orgClassroom = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(
          and(
            eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationClassrooms.classroomId, input.id)
          )
        )
        .limit(1);

      if (!orgClassroom.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Classroom not found or access denied',
        });
      }

      // Verify groupId belongs to the org (skip if null to deactivate group)
      if (input.groupId !== null) {
        const orgGroup = await db
          .select()
          .from(schema.cpOrganizationGroups)
          .where(
            and(
              eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
              eq(schema.cpOrganizationGroups.groupId, input.groupId)
            )
          )
          .limit(1);

        if (!orgGroup.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Group not found or access denied',
          });
        }
      }

      const [updated] = await openpathDb
        .update(classrooms)
        .set({ activeGroupId: input.groupId } as any)
        .where(eq(classrooms.id, input.id))
        .returning();

      const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: updated.id });

      // Serialize Date fields for JSON compatibility
      return {
        id: updated.id,
        name: updated.name,
        displayName: updated.displayName,
        defaultGroupId: updated.defaultGroupId,
        activeGroupId: updated.activeGroupId,
        currentGroupId: updated.activeGroupId ?? currentScheduleGroupId ?? updated.defaultGroupId,
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      };
    }),

  deleteMachine: tenantProcedure
    .input(z.object({ id: z.string(), classroomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgClassroom = await db
        .select()
        .from(schema.cpOrganizationClassrooms)
        .where(
          and(
            eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationClassrooms.classroomId, input.classroomId)
          )
        )
        .limit(1);

      if (!orgClassroom.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Classroom not found or access denied',
        });
      }

      await openpathDb
        .delete(machines)
        .where(and(eq(machines.id, input.id), eq(machines.classroomId, input.classroomId)));

      return { success: true };
    }),

  create: tenantProcedure.input(CreateClassroomSchema).mutation(async ({ ctx, input }) => {
    const classroomId = nanoid();

    const [classroom] = await openpathDb
      .insert(classrooms)
      .values({
        id: classroomId,
        name: input.name,
        displayName: input.displayName ?? input.name, // Default to name if not provided
        defaultGroupId: input.defaultGroupId,
      })
      .returning();

    await db.insert(schema.cpOrganizationClassrooms).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      classroomId: classroom.id,
    });

    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: classroom.id });

    // Serialize Date fields for JSON compatibility
    return {
      id: classroom.id,
      name: classroom.name,
      displayName: classroom.displayName,
      defaultGroupId: classroom.defaultGroupId,
      activeGroupId: classroom.activeGroupId,
      currentGroupId:
        classroom.activeGroupId ?? currentScheduleGroupId ?? classroom.defaultGroupId ?? null,
      createdAt: classroom.createdAt?.toISOString() ?? null,
      updatedAt: classroom.updatedAt?.toISOString() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateClassroomSchema).mutation(async ({ ctx, input }) => {
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    const { id, ...updateData } = input;
    const [updated] = await openpathDb
      .update(classrooms)
      .set(updateData)
      .where(eq(classrooms.id, id))
      .returning();

    const currentScheduleGroupId = await getCurrentScheduleGroupId({ classroomId: updated.id });

    // Serialize Date fields for JSON compatibility
    return {
      id: updated.id,
      name: updated.name,
      displayName: updated.displayName,
      defaultGroupId: updated.defaultGroupId,
      activeGroupId: updated.activeGroupId,
      currentGroupId: updated.activeGroupId ?? currentScheduleGroupId ?? updated.defaultGroupId,
      createdAt: updated.createdAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt?.toISOString() ?? null,
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const orgClassroom = await db
      .select()
      .from(schema.cpOrganizationClassrooms)
      .where(
        and(
          eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationClassrooms.classroomId, input.id)
        )
      )
      .limit(1);

    if (!orgClassroom.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found or access denied',
      });
    }

    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom[0].id));

    await openpathDb.delete(classrooms).where(eq(classrooms.id, input.id));

    return { success: true };
  }),
});
