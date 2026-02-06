// @ts-nocheck
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
  role: z.enum(['admin', 'teacher', 'student']).optional(),
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
    const orgUsers = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!));

    const userIds = orgUsers.map((ou) => ou.openpathUserId);

    if (userIds.length === 0) return [];

    const usersList = await openpathDb.select().from(users).where(inArray(users.id, userIds));

    // Serialize Date fields for JSON compatibility
    return usersList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: u.passwordHash,
      isActive: u.isActive,
      createdAt: u.createdAt?.toISOString() ?? null,
      updatedAt: u.updatedAt?.toISOString() ?? null,
    }));
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const orgUser = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.id)
        )
      )
      .limit(1);

    if (!orgUser.length) {
      throw new Error('User not found or access denied');
    }

    const user = await openpathDb.select().from(users).where(eq(users.id, input.id)).limit(1);

    if (!user[0]) return null;

    // Serialize Date fields for JSON compatibility
    const u = user[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: u.passwordHash,
      isActive: u.isActive,
      createdAt: u.createdAt?.toISOString() ?? null,
      updatedAt: u.updatedAt?.toISOString() ?? null,
    };
  }),

  getRole: tenantProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
    const orgUser = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.userId)
        )
      )
      .limit(1);

    if (!orgUser.length) {
      throw new Error('User not found or access denied');
    }

    const role = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, input.userId))
      .limit(1);

    if (!role[0]) return null;

    // Serialize Date fields for JSON compatibility
    const r = role[0];
    return {
      id: r.id,
      userId: r.userId,
      role: r.role,
      groupIds: r.groupIds,
      createdBy: r.createdBy,
      createdAt: r.createdAt?.toISOString() ?? null,
    };
  }),

  create: tenantProcedure.input(CreateUserSchema).mutation(async ({ ctx, input }) => {
    const userId = nanoid();
    const passwordHash = await bcrypt.hash(input.password, 10);

    const [user] = await openpathDb
      .insert(users)
      .values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
        isActive: true as any,
      })
      .returning();

    await db.insert(schema.cpOrganizationUsers).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      openpathUserId: user.id,
    });

    // Assign role if provided
    if (input.role) {
      await openpathDb.insert(roles).values({
        id: nanoid(),
        userId: user.id,
        role: input.role,
        groupIds: [] as any,
        createdBy: ctx.user.sub,
      });
    }

    // Serialize Date fields for JSON compatibility
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      isActive: user.isActive,
      createdAt: user.createdAt?.toISOString() ?? null,
      updatedAt: user.updatedAt?.toISOString() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateUserSchema).mutation(async ({ ctx, input }) => {
    const orgUser = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.id)
        )
      )
      .limit(1);

    if (!orgUser.length) {
      throw new Error('User not found or access denied');
    }

    const { id, ...updateData } = input;
    const [updated] = await openpathDb
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    // Serialize Date fields for JSON compatibility
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      passwordHash: updated.passwordHash,
      isActive: updated.isActive,
      createdAt: updated.createdAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt?.toISOString() ?? null,
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const orgUser = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.id)
        )
      )
      .limit(1);

    if (!orgUser.length) {
      throw new Error('User not found or access denied');
    }

    await db
      .delete(schema.cpOrganizationUsers)
      .where(eq(schema.cpOrganizationUsers.id, orgUser[0].id));

    await openpathDb.delete(users).where(eq(users.id, input.id));

    return { success: true };
  }),

  assignRole: tenantProcedure.input(AssignRoleSchema).mutation(async ({ ctx, input }) => {
    const orgUser = await db
      .select()
      .from(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.userId)
        )
      )
      .limit(1);

    if (!orgUser.length) {
      throw new Error('User not found or access denied');
    }

    const existingRole = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, input.userId))
      .limit(1);

    if (existingRole.length) {
      const [updated] = await openpathDb
        .update(roles)
        .set({
          role: input.role,
          groupIds: input.groupIds,
        })
        .where(eq(roles.userId, input.userId))
        .returning();

      // Serialize Date fields for JSON compatibility
      return {
        id: updated.id,
        userId: updated.userId,
        role: updated.role,
        groupIds: updated.groupIds,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt?.toISOString() ?? null,
      };
    } else {
      const [role] = await openpathDb
        .insert(roles)
        .values({
          id: nanoid(),
          userId: input.userId,
          role: input.role,
          groupIds: input.groupIds,
          createdBy: ctx.user.sub,
        })
        .returning();

      // Serialize Date fields for JSON compatibility
      return {
        id: role.id,
        userId: role.userId,
        role: role.role,
        groupIds: role.groupIds,
        createdBy: role.createdBy,
        createdAt: role.createdAt?.toISOString() ?? null,
      };
    }
  }),

  revokeRole: tenantProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgUser = await db
        .select()
        .from(schema.cpOrganizationUsers)
        .where(
          and(
            eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationUsers.openpathUserId, input.userId)
          )
        )
        .limit(1);

      if (!orgUser.length) {
        throw new Error('User not found or access denied');
      }

      await openpathDb.delete(roles).where(eq(roles.userId, input.userId));

      return { success: true };
    }),
});
