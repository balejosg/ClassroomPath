import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, users, roles } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';

const CreateUserSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(255),
    password: z.string().min(8),
});

const UpdateUserSchema = z.object({
    id: z.string(),
    name: z.string().min(1).max(255).optional(),
    active: z.boolean().optional(),
});

const AssignRoleSchema = z.object({
    userId: z.string(),
    role: z.enum(['admin', 'teacher', 'student']),
    groupIds: z.array(z.string()).optional(),
});

export const usersRouter = router({
    list: tenantProcedure.query(async ({ ctx }) => {
        const orgUsers = await db.select()
            .from(schema.cpOrganizationUsers)
            .where(eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!));

        const userIds = orgUsers.map(ou => ou.openpathUserId);

        if (userIds.length === 0) return [];

        const usersList = await openpathDb.select()
            .from(users)
            .where(inArray(users.id, userIds));

        return usersList;
    }),

    getById: tenantProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const orgUser = await db.select()
                .from(schema.cpOrganizationUsers)
                .where(and(
                    eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationUsers.openpathUserId, input.id)
                ))
                .limit(1);

            if (!orgUser.length) {
                throw new Error('User not found or access denied');
            }

            const user = await openpathDb.select()
                .from(users)
                .where(eq(users.id, input.id))
                .limit(1);

            return user[0] || null;
        }),

    getRole: tenantProcedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => {
            const orgUser = await db.select()
                .from(schema.cpOrganizationUsers)
                .where(and(
                    eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationUsers.openpathUserId, input.userId)
                ))
                .limit(1);

            if (!orgUser.length) {
                throw new Error('User not found or access denied');
            }

            const role = await openpathDb.select()
                .from(roles)
                .where(eq(roles.userId, input.userId))
                .limit(1);

            return role[0] || null;
        }),

    create: tenantProcedure
        .input(CreateUserSchema)
        .mutation(async ({ ctx, input }) => {
            const userId = nanoid();
            const passwordHash = await bcrypt.hash(input.password, 10);

            const [user] = await openpathDb.insert(users)
                .values({
                    id: userId,
                    email: input.email,
                    name: input.name,
                    passwordHash,
                    isActive: true,
                })
                .returning();

            await db.insert(schema.cpOrganizationUsers)
                .values({
                    id: nanoid(),
                    organizationId: ctx.organizationId!,
                    openpathUserId: user.id,
                });

            return user;
        }),

    update: tenantProcedure
        .input(UpdateUserSchema)
        .mutation(async ({ ctx, input }) => {
            const orgUser = await db.select()
                .from(schema.cpOrganizationUsers)
                .where(and(
                    eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationUsers.openpathUserId, input.id)
                ))
                .limit(1);

            if (!orgUser.length) {
                throw new Error('User not found or access denied');
            }

            const { id, ...updateData } = input;
            const [updated] = await openpathDb.update(users)
                .set(updateData)
                .where(eq(users.id, id))
                .returning();

            return updated;
        }),

    delete: tenantProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const orgUser = await db.select()
                .from(schema.cpOrganizationUsers)
                .where(and(
                    eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationUsers.openpathUserId, input.id)
                ))
                .limit(1);

            if (!orgUser.length) {
                throw new Error('User not found or access denied');
            }

            await db.delete(schema.cpOrganizationUsers)
                .where(eq(schema.cpOrganizationUsers.id, orgUser[0].id));

            await openpathDb.delete(users)
                .where(eq(users.id, input.id));

            return { success: true };
        }),

    assignRole: tenantProcedure
        .input(AssignRoleSchema)
        .mutation(async ({ ctx, input }) => {
            const orgUser = await db.select()
                .from(schema.cpOrganizationUsers)
                .where(and(
                    eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationUsers.openpathUserId, input.userId)
                ))
                .limit(1);

            if (!orgUser.length) {
                throw new Error('User not found or access denied');
            }

            const existingRole = await openpathDb.select()
                .from(roles)
                .where(eq(roles.userId, input.userId))
                .limit(1);

            if (existingRole.length) {
                const [updated] = await openpathDb.update(roles)
                    .set({
                        role: input.role,
                        groupIds: input.groupIds,
                    })
                    .where(eq(roles.userId, input.userId))
                    .returning();

                return updated;
            } else {
                const [role] = await openpathDb.insert(roles)
                    .values({
                        id: nanoid(),
                        userId: input.userId,
                        role: input.role,
                        groupIds: input.groupIds,
                        createdBy: ctx.user.sub,
                    })
                    .returning();

                return role;
            }
        }),
});
