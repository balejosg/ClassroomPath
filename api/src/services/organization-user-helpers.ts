import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getRoleByUserId } from '../db/openpath-repos/roles.repo.js';
import { getUsersByIds } from '../db/openpath-repos/users.repo.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import { normalizeRoleGroupIds, presentUserWithRoles } from './presenters.js';
import {
  assertOrganizationUserAccess,
  getRolesByUserId,
} from './organization-user-access.service.js';

export type OrganizationUserParams = {
  organizationId: string;
  userId: string;
};

export const LAST_ADMIN_CONFLICT_MESSAGE = 'Cannot remove the last admin from the organization';

export async function presentOrganizationUserById(userId: string, nowIso?: string) {
  const [userRows, rolesByUserId] = await Promise.all([
    getUsersByIds([userId]),
    getRolesByUserId([userId]),
  ]);

  const user = userRows[0];
  if (!user) return null;

  return presentUserWithRoles({
    user,
    roles: rolesByUserId.get(user.id) ?? [],
    nowIso,
  });
}

export async function getPersistedUserRole(userId: string) {
  const role = await getRoleByUserId(userId);

  if (!role) {
    return null;
  }

  return {
    ...role,
    groupIds: normalizeRoleGroupIds(role.groupIds),
  };
}

export async function assertManagedOrganizationUser(params: OrganizationUserParams): Promise<void> {
  await assertOrganizationUserAccess(params);
  await getSingleMembershipOrThrow(params.userId);
}

export async function assertOrganizationAdminSurvivability(params: {
  organizationId: string;
  userId: string;
  nextRole?: 'admin' | 'teacher' | null;
}): Promise<void> {
  const [membership] = await db
    .select()
    .from(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, params.userId)
      )
    )
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return;
  }

  if (params.nextRole === 'admin') {
    return;
  }

  const adminMemberships = await db
    .select({ userId: schema.cpMemberships.userId })
    .from(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.role, 'admin')
      )
    );

  if (adminMemberships.length <= 1) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: LAST_ADMIN_CONFLICT_MESSAGE,
    });
  }
}
