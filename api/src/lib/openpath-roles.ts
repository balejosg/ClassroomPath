import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, openpathSchema } from '../db/openpath.js';
import { listMembershipsForUser, throwMembershipConflict } from './tenant-memberships.js';

export interface RoleInfo {
  role: 'admin' | 'teacher';
  groupIds: string[];
}

function normalizeGroupIds(groupIds: unknown): string[] {
  if (!Array.isArray(groupIds)) return [];
  return groupIds.filter((groupId): groupId is string => typeof groupId === 'string');
}

function toMirroredOpenPathRole(role: string): RoleInfo['role'] {
  return role === 'admin' ? 'admin' : 'teacher';
}

export async function getUserRoles(userId: string): Promise<RoleInfo[]> {
  const result = await openpathDb
    .select()
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, userId));

  return result.map((r) => ({
    role: r.role as 'admin' | 'teacher',
    groupIds: normalizeGroupIds(r.groupIds),
  }));
}

export async function synchronizeOpenPathRole(params: {
  userId: string;
  actedBy: string;
  groupIds?: readonly string[];
}): Promise<RoleInfo | null> {
  const memberships = await listMembershipsForUser(params.userId);
  if (memberships.length > 1) {
    throwMembershipConflict(memberships.length);
  }

  const membership = memberships[0] ?? null;
  if (!membership) {
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, params.userId));
    return null;
  }

  const existing = await openpathDb
    .select()
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, params.userId))
    .limit(1);

  const mirroredRole = toMirroredOpenPathRole(membership.role);
  const nextGroupIds =
    params.groupIds !== undefined
      ? normalizeGroupIds(params.groupIds)
      : normalizeGroupIds(existing[0]?.groupIds);

  if (existing.length === 0) {
    await openpathDb.insert(openpathSchema.roles).values({
      id: nanoid(),
      userId: params.userId,
      role: mirroredRole,
      groupIds: nextGroupIds,
      createdBy: params.actedBy,
    });

    return {
      role: mirroredRole,
      groupIds: nextGroupIds,
    };
  }

  const [updated] = await openpathDb
    .update(openpathSchema.roles)
    .set({
      role: mirroredRole,
      groupIds: nextGroupIds,
    })
    .where(eq(openpathSchema.roles.userId, params.userId))
    .returning();

  return {
    role: updated.role as RoleInfo['role'],
    groupIds: normalizeGroupIds(updated.groupIds),
  };
}
