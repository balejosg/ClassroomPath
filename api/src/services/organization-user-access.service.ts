import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, roles } from '../db/openpath.js';
import { normalizeRoleGroupIds, type RoleInfo } from './presenters.js';

export async function getOrganizationUserIds(params: {
  organizationId: string;
}): Promise<string[]> {
  const memberships = await db
    .select({ userId: schema.cpMemberships.userId })
    .from(schema.cpMemberships)
    .where(eq(schema.cpMemberships.organizationId, params.organizationId));

  return memberships.map((membership) => membership.userId);
}

export async function assertOrganizationUserAccess(params: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const userIds = await getOrganizationUserIds({ organizationId: params.organizationId });
  if (!userIds.includes(params.userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User not found or access denied' });
  }
}

export async function getRolesByUserId(userIds: string[]): Promise<Map<string, RoleInfo[]>> {
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
