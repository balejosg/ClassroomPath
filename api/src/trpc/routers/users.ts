import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, users, roles } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { TRPCError } from '@trpc/server';
import { generateId } from '../../lib/id.js';
import { getSingleMembershipOrThrow } from '../../lib/tenant-memberships.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';

type RoleInfo = { role: string; groupIds: string[] };

function requireOrgAdmin(ctx: { userRole?: string }) {
  if (ctx.userRole !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization admins can manage users',
    });
  }
}

function toIsoStringOrNull(date: unknown): string | null {
  if (date instanceof Date) return date.toISOString();
  return null;
}

function normalizeGroupIds(groupIds: unknown): string[] {
  if (Array.isArray(groupIds)) return groupIds.filter((x) => typeof x === 'string') as string[];
  return [];
}

async function getOrgScopedUserIds(params: { organizationId: string }): Promise<string[]> {
  const memberships = await db
    .select({ userId: schema.cpMemberships.userId })
    .from(schema.cpMemberships)
    .where(eq(schema.cpMemberships.organizationId, params.organizationId));

  return memberships.map((membership) => membership.userId);
}

async function getRolesByUserId(userIds: string[]): Promise<Map<string, RoleInfo[]>> {
  const result = new Map<string, RoleInfo[]>();
  if (userIds.length === 0) return result;

  const rows = await openpathDb.select().from(roles).where(inArray(roles.userId, userIds));

  for (const r of rows) {
    const current = result.get(r.userId) ?? [];
    current.push({ role: String(r.role), groupIds: normalizeGroupIds(r.groupIds) });
    result.set(r.userId, current);
  }

  return result;
}

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8),
  role: z.enum(['admin', 'teacher']).default('teacher'),
});

const UpdateUserSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
});

const AssignRoleSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'teacher']),
  groupIds: z.array(z.string()).default([]),
});

export const usersRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (userIds.length === 0) return [];

    const [usersList, rolesByUserId] = await Promise.all([
      openpathDb.select().from(users).where(inArray(users.id, userIds)),
      getRolesByUserId(userIds),
    ]);

    // IMPORTANT: Never expose passwordHash (security).
    return usersList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.isActive,
      emailVerified: u.emailVerified,
      createdAt: toIsoStringOrNull(u.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoStringOrNull(u.updatedAt) ?? new Date().toISOString(),
      roles: rolesByUserId.get(u.id) ?? [],
    }));
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (!userIds.includes(input.id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
    }

    const [user, rolesByUserId] = await Promise.all([
      openpathDb.select().from(users).where(eq(users.id, input.id)).limit(1),
      getRolesByUserId([input.id]),
    ]);

    if (!user[0]) return null;

    const u = user[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.isActive,
      emailVerified: u.emailVerified,
      createdAt: toIsoStringOrNull(u.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoStringOrNull(u.updatedAt) ?? new Date().toISOString(),
      roles: rolesByUserId.get(u.id) ?? [],
    };
  }),

  getRole: tenantProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (!userIds.includes(input.userId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
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
    requireOrgAdmin(ctx);

    const userId = nanoid();
    const passwordHash = await bcrypt.hash(input.password, 10);

    const [user] = await openpathDb
      .insert(users)
      .values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
        isActive: true,
      })
      .returning();

    // Grant organization membership so the user can actually join the tenant.
    await db.insert(schema.cpMemberships).values({
      id: generateId('mem'),
      userId: user.id,
      organizationId: ctx.organizationId!,
      role: input.role,
      invitedBy: ctx.user.sub,
    });

    await synchronizeOpenPathRole({
      userId: user.id,
      actedBy: ctx.user.sub,
      groupIds: [],
    });

    // Serialize Date fields for JSON compatibility
    const rolesByUserId = await getRolesByUserId([user.id]);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: toIsoStringOrNull(user.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoStringOrNull(user.updatedAt) ?? new Date().toISOString(),
      roles: rolesByUserId.get(user.id) ?? [],
    };
  }),

  update: tenantProcedure.input(UpdateUserSchema).mutation(async ({ ctx, input }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (!userIds.includes(input.id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
    }

    await getSingleMembershipOrThrow(input.id);

    const updateData: { name?: string; isActive?: boolean } = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.active !== undefined) updateData.isActive = input.active;

    const [updated] = await openpathDb
      .update(users)
      .set(updateData)
      .where(eq(users.id, input.id))
      .returning();

    const rolesByUserId = await getRolesByUserId([updated.id]);
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      isActive: updated.isActive,
      emailVerified: updated.emailVerified,
      createdAt: toIsoStringOrNull(updated.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoStringOrNull(updated.updatedAt) ?? new Date().toISOString(),
      roles: rolesByUserId.get(updated.id) ?? [],
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (!userIds.includes(input.id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
    }

    // Best-effort cleanup in both org mapping tables.
    await db
      .delete(schema.cpOrganizationUsers)
      .where(
        and(
          eq(schema.cpOrganizationUsers.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationUsers.openpathUserId, input.id)
        )
      );

    await db
      .delete(schema.cpMemberships)
      .where(
        and(
          eq(schema.cpMemberships.organizationId, ctx.organizationId!),
          eq(schema.cpMemberships.userId, input.id)
        )
      );

    await synchronizeOpenPathRole({
      userId: input.id,
      actedBy: ctx.user.sub,
    });

    return { success: true };
  }),

  assignRole: tenantProcedure.input(AssignRoleSchema).mutation(async ({ ctx, input }) => {
    requireOrgAdmin(ctx);

    const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
    if (!userIds.includes(input.userId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
    }

    await getSingleMembershipOrThrow(input.userId);

    await db
      .update(schema.cpMemberships)
      .set({ role: input.role })
      .where(
        and(
          eq(schema.cpMemberships.organizationId, ctx.organizationId!),
          eq(schema.cpMemberships.userId, input.userId)
        )
      );

    const synchronizedRole = await synchronizeOpenPathRole({
      userId: input.userId,
      actedBy: ctx.user.sub,
      groupIds: input.groupIds,
    });

    if (!synchronizedRole) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to synchronize upstream role state',
      });
    }

    const [persistedRole] = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, input.userId))
      .limit(1);

    return {
      id: persistedRole?.id ?? '',
      userId: input.userId,
      role: synchronizedRole.role,
      groupIds: synchronizedRole.groupIds,
      createdBy: persistedRole?.createdBy ?? ctx.user.sub,
      createdAt: persistedRole?.createdAt?.toISOString() ?? null,
    };
  }),

  revokeRole: tenantProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgAdmin(ctx);

      const userIds = await getOrgScopedUserIds({ organizationId: ctx.organizationId! });
      if (!userIds.includes(input.userId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
      }

      await getSingleMembershipOrThrow(input.userId);

      await db
        .update(schema.cpMemberships)
        .set({ role: 'teacher' })
        .where(
          and(
            eq(schema.cpMemberships.organizationId, ctx.organizationId!),
            eq(schema.cpMemberships.userId, input.userId)
          )
        );

      await synchronizeOpenPathRole({
        userId: input.userId,
        actedBy: ctx.user.sub,
        groupIds: [],
      });

      return { success: true };
    }),
});
