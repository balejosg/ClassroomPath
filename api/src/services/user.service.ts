import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, roles, users } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import {
  normalizeRoleGroupIds,
  presentUserRole,
  presentUserWithRoles,
  type RoleInfo,
} from './presenters.js';

async function getOrgScopedUserIds(params: { organizationId: string }): Promise<string[]> {
  const memberships = await db
    .select({ userId: schema.cpMemberships.userId })
    .from(schema.cpMemberships)
    .where(eq(schema.cpMemberships.organizationId, params.organizationId));

  return memberships.map((membership) => membership.userId);
}

async function assertOrganizationUserAccess(params: { organizationId: string; userId: string }) {
  const userIds = await getOrgScopedUserIds({ organizationId: params.organizationId });
  if (!userIds.includes(params.userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
  }
}

async function getRolesByUserId(userIds: string[]): Promise<Map<string, RoleInfo[]>> {
  const result = new Map<string, RoleInfo[]>();
  if (userIds.length === 0) return result;

  const rows = await openpathDb.select().from(roles).where(inArray(roles.userId, userIds));

  for (const role of rows) {
    const current = result.get(role.userId) ?? [];
    current.push({
      role: String(role.role),
      groupIds: normalizeRoleGroupIds(role.groupIds),
    });
    result.set(role.userId, current);
  }

  return result;
}

export async function listOrganizationUsers(organizationId: string) {
  const userIds = await getOrgScopedUserIds({ organizationId });
  if (userIds.length === 0) return [];

  const [usersList, rolesByUserId] = await Promise.all([
    openpathDb.select().from(users).where(inArray(users.id, userIds)),
    getRolesByUserId(userIds),
  ]);
  const nowIso = new Date().toISOString();

  return usersList.map((user) =>
    presentUserWithRoles({
      user,
      roles: rolesByUserId.get(user.id) ?? [],
      nowIso,
    })
  );
}

export async function getOrganizationUserById(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);

  const [userRows, rolesByUserId] = await Promise.all([
    openpathDb.select().from(users).where(eq(users.id, params.userId)).limit(1),
    getRolesByUserId([params.userId]),
  ]);

  const user = userRows[0];
  if (!user) return null;

  return presentUserWithRoles({
    user,
    roles: rolesByUserId.get(user.id) ?? [],
  });
}

export async function getOrganizationUserRole(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);

  const [role] = await openpathDb
    .select()
    .from(roles)
    .where(eq(roles.userId, params.userId))
    .limit(1);

  if (!role) return null;

  return presentUserRole({
    role,
    fallback: {
      userId: params.userId,
      role: role.role,
      groupIds: normalizeRoleGroupIds(role.groupIds),
      createdBy: role.createdBy ?? undefined,
    },
  });
}

export async function createOrganizationUser(params: {
  organizationId: string;
  actedBy: string;
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'teacher';
}) {
  const userId = nanoid();
  const passwordHash = await bcrypt.hash(params.password, 10);

  const [user] = await openpathDb
    .insert(users)
    .values({
      id: userId,
      email: params.email,
      name: params.name,
      passwordHash,
      isActive: true,
    })
    .returning();

  await db.insert(schema.cpMemberships).values({
    id: generateId('mem'),
    userId: user.id,
    organizationId: params.organizationId,
    role: params.role,
    invitedBy: params.actedBy,
  });

  await synchronizeOpenPathRole({
    userId: user.id,
    actedBy: params.actedBy,
    groupIds: [],
  });

  const rolesByUserId = await getRolesByUserId([user.id]);
  return presentUserWithRoles({
    user,
    roles: rolesByUserId.get(user.id) ?? [],
  });
}

export async function updateOrganizationUser(params: {
  organizationId: string;
  userId: string;
  name?: string;
  active?: boolean;
}) {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);

  const updateData: { name?: string; isActive?: boolean } = {};
  if (params.name !== undefined) updateData.name = params.name;
  if (params.active !== undefined) updateData.isActive = params.active;

  const [updated] = await openpathDb
    .update(users)
    .set(updateData)
    .where(eq(users.id, params.userId))
    .returning();

  const rolesByUserId = await getRolesByUserId([updated.id]);
  return presentUserWithRoles({
    user: updated,
    roles: rolesByUserId.get(updated.id) ?? [],
  });
}

export async function deleteOrganizationUser(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertOrganizationUserAccess(params);

  await db
    .delete(schema.cpOrganizationUsers)
    .where(
      and(
        eq(schema.cpOrganizationUsers.organizationId, params.organizationId),
        eq(schema.cpOrganizationUsers.openpathUserId, params.userId)
      )
    );

  await db
    .delete(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    );

  await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.actedBy,
  });

  return { success: true };
}

export async function assignOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
  role: 'admin' | 'teacher';
  groupIds: string[];
}) {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);

  await db
    .update(schema.cpMemberships)
    .set({ role: params.role })
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    );

  const synchronizedRole = await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.actedBy,
    groupIds: params.groupIds,
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
    .where(eq(roles.userId, params.userId))
    .limit(1);

  return presentUserRole({
    role: persistedRole,
    fallback: {
      userId: params.userId,
      role: synchronizedRole.role,
      groupIds: synchronizedRole.groupIds,
      createdBy: params.actedBy,
    },
  });
}

export async function revokeOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);

  await db
    .update(schema.cpMemberships)
    .set({ role: 'teacher' })
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    );

  await synchronizeOpenPathRole({
    userId: params.userId,
    actedBy: params.actedBy,
    groupIds: [],
  });

  return { success: true };
}
