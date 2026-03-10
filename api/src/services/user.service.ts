import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, roles, users } from '../db/openpath.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import { normalizeRoleGroupIds, presentUserRole, presentUserWithRoles } from './presenters.js';
import {
  createOrganizationInvitation,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
} from './invitations.service.js';
import {
  assertOrganizationUserAccess,
  getOrganizationUserIds,
  getRolesByUserId,
} from './organization-user-access.service.js';

export async function listOrganizationUsers(organizationId: string) {
  const userIds = await getOrganizationUserIds({ organizationId });
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
  role: 'admin' | 'teacher';
}) {
  return createOrganizationInvitation({
    organizationId: params.organizationId,
    invitedBy: params.actedBy,
    email: params.email.trim().toLowerCase(),
    name: params.name.trim(),
    role: params.role,
  });
}

export { listOrganizationInvitations, revokeOrganizationInvitation };

export async function updateOrganizationUser(params: {
  organizationId: string;
  userId: string;
  name?: string;
  active?: boolean;
}) {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);

  const updateData: { name?: string; isActive?: boolean } = {};
  if (params.name !== undefined) updateData.name = params.name.trim();
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
