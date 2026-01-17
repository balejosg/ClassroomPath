import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { classrooms, machines } from '../../db/openpath.js';

const CreateClassroomSchema = z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().min(1).max(255),
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
        const orgClassrooms = await db.select()
            .from(schema.cpOrganizationClassrooms)
            .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

        const classroomIds = orgClassrooms.map(oc => oc.classroomId);

        if (classroomIds.length === 0) return [];

        const result = await openpathDb.select()
            .from(classrooms)
            .where(inArray(classrooms.id, classroomIds));

        // Serialize Date fields for JSON compatibility
        return result.map(c => ({
            id: c.id,
            name: c.name,
            displayName: c.displayName,
            defaultGroupId: c.defaultGroupId,
            activeGroupId: c.activeGroupId,
            createdAt: c.createdAt?.toISOString() ?? null,
            updatedAt: c.updatedAt?.toISOString() ?? null,
        }));
    }),

    getById: tenantProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const orgClassroom = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(and(
                    eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationClassrooms.classroomId, input.id)
                ))
                .limit(1);

            if (!orgClassroom.length) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Classroom not found or access denied'
                });
            }

            const classroom = await openpathDb.select()
                .from(classrooms)
                .where(eq(classrooms.id, input.id))
                .limit(1);

            if (!classroom[0]) return null;

            // Serialize Date fields for JSON compatibility
            const c = classroom[0];
            return {
                id: c.id,
                name: c.name,
                displayName: c.displayName,
                defaultGroupId: c.defaultGroupId,
                activeGroupId: c.activeGroupId,
                createdAt: c.createdAt?.toISOString() ?? null,
                updatedAt: c.updatedAt?.toISOString() ?? null,
            };
        }),

    listMachines: tenantProcedure
        .input(z.object({ classroomId: z.string().optional() }))
        .query(async ({ ctx, input }) => {
            // Get all classrooms for this organization
            const orgClassrooms = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!));

            const classroomIds = orgClassrooms.map(oc => oc.classroomId);

            if (classroomIds.length === 0) return [];

            // If specific classroom requested, verify access
            if (input.classroomId) {
                if (!classroomIds.includes(input.classroomId)) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Classroom not found or access denied'
                    });
                }

                // Return machines for specific classroom
                const result = await openpathDb.select()
                    .from(machines)
                    .where(eq(machines.classroomId, input.classroomId));

                return result.map(m => ({
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
            const result = await openpathDb.select()
                .from(machines)
                .where(inArray(machines.classroomId, classroomIds));

            // Explicitly serialize Date fields for JSON compatibility
            return result.map(m => ({
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
            const orgClassroom = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(and(
                    eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationClassrooms.classroomId, input.id)
                ))
                .limit(1);

            if (!orgClassroom.length) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Classroom not found or access denied'
                });
            }

            // Verify groupId belongs to the org (skip if null to deactivate group)
            if (input.groupId !== null) {
                const orgGroup = await db.select()
                    .from(schema.cpOrganizationGroups)
                    .where(and(
                        eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                        eq(schema.cpOrganizationGroups.groupId, input.groupId)
                    ))
                    .limit(1);

                if (!orgGroup.length) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Group not found or access denied'
                    });
                }
            }

            const [updated] = await openpathDb.update(classrooms)
                .set({ activeGroupId: input.groupId })
                .where(eq(classrooms.id, input.id))
                .returning();

            // Serialize Date fields for JSON compatibility
            return {
                id: updated.id,
                name: updated.name,
                displayName: updated.displayName,
                defaultGroupId: updated.defaultGroupId,
                activeGroupId: updated.activeGroupId,
                createdAt: updated.createdAt?.toISOString() ?? null,
                updatedAt: updated.updatedAt?.toISOString() ?? null,
            };
        }),

    deleteMachine: tenantProcedure
        .input(z.object({ id: z.string(), classroomId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const orgClassroom = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(and(
                    eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationClassrooms.classroomId, input.classroomId)
                ))
                .limit(1);

            if (!orgClassroom.length) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Classroom not found or access denied'
                });
            }

            await openpathDb.delete(machines)
                .where(and(
                    eq(machines.id, input.id),
                    eq(machines.classroomId, input.classroomId)
                ));

            return { success: true };
        }),

    create: tenantProcedure
        .input(CreateClassroomSchema)
        .mutation(async ({ ctx, input }) => {
            const classroomId = nanoid();

            const [classroom] = await openpathDb.insert(classrooms)
                .values({
                    id: classroomId,
                    name: input.name,
                    displayName: input.displayName,
                    defaultGroupId: input.defaultGroupId,
                })
                .returning();

            await db.insert(schema.cpOrganizationClassrooms)
                .values({
                    id: nanoid(),
                    organizationId: ctx.organizationId!,
                    classroomId: classroom.id,
                });

            // Serialize Date fields for JSON compatibility
            return {
                id: classroom.id,
                name: classroom.name,
                displayName: classroom.displayName,
                defaultGroupId: classroom.defaultGroupId,
                activeGroupId: classroom.activeGroupId,
                createdAt: classroom.createdAt?.toISOString() ?? null,
                updatedAt: classroom.updatedAt?.toISOString() ?? null,
            };
        }),

    update: tenantProcedure
        .input(UpdateClassroomSchema)
        .mutation(async ({ ctx, input }) => {
            const orgClassroom = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(and(
                    eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationClassrooms.classroomId, input.id)
                ))
                .limit(1);

            if (!orgClassroom.length) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Classroom not found or access denied'
                });
            }

            const { id, ...updateData } = input;
            const [updated] = await openpathDb.update(classrooms)
                .set(updateData)
                .where(eq(classrooms.id, id))
                .returning();

            // Serialize Date fields for JSON compatibility
            return {
                id: updated.id,
                name: updated.name,
                displayName: updated.displayName,
                defaultGroupId: updated.defaultGroupId,
                activeGroupId: updated.activeGroupId,
                createdAt: updated.createdAt?.toISOString() ?? null,
                updatedAt: updated.updatedAt?.toISOString() ?? null,
            };
        }),

    delete: tenantProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const orgClassroom = await db.select()
                .from(schema.cpOrganizationClassrooms)
                .where(and(
                    eq(schema.cpOrganizationClassrooms.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationClassrooms.classroomId, input.id)
                ))
                .limit(1);

            if (!orgClassroom.length) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Classroom not found or access denied'
                });
            }

            await db.delete(schema.cpOrganizationClassrooms)
                .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom[0].id));

            await openpathDb.delete(classrooms)
                .where(eq(classrooms.id, input.id));

            return { success: true };
        }),
});
