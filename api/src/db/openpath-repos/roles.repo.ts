import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, roles } from '../openpath.js';

// Owning module for roles-table writes (statements moved verbatim from
// lib/openpath-roles.ts and services/group-role-membership.service.ts).
// No notify pairing (F5). Tenant scoping stays with the callers -- the
// tenant-service-guard exemptions for the calling leaves document that
// contract; this module must never import lib/tenant-access.

export type RoleRow = typeof roles.$inferSelect;

export async function getRolesByUserId(userId: string): Promise<RoleRow[]> {
  return openpathDb.select().from(roles).where(eq(roles.userId, userId));
}

export async function getRoleByUserId(userId: string): Promise<RoleRow | undefined> {
  const existing = await openpathDb.select().from(roles).where(eq(roles.userId, userId)).limit(1);
  return existing[0];
}

export async function getRolesByUserIds(userIds: readonly string[]): Promise<RoleRow[]> {
  if (userIds.length === 0) {
    return [];
  }
  return openpathDb
    .select()
    .from(roles)
    .where(inArray(roles.userId, [...userIds]));
}

export async function deleteRolesByUserId(userId: string): Promise<void> {
  await openpathDb.delete(roles).where(eq(roles.userId, userId));
}

export async function insertRole(values: {
  id: string;
  userId: string;
  role: string;
  groupIds: string[];
  createdBy: string;
}): Promise<void> {
  await openpathDb.insert(roles).values(values);
}

export async function updateRoleByUserIdReturning(
  userId: string,
  set: { role: string; groupIds: string[] }
): Promise<RoleRow> {
  const [updated] = await openpathDb
    .update(roles)
    .set(set)
    .where(eq(roles.userId, userId))
    .returning();
  return updated;
}

export async function addGroupToTeacherRole(params: {
  userId: string;
  groupId: string;
  createdBy: string;
}): Promise<void> {
  const existingRoles = await openpathDb
    .select()
    .from(roles)
    .where(eq(roles.userId, params.userId));
  const teacherRole = existingRoles.find((role) => role.role === 'teacher');

  if (!teacherRole) {
    await openpathDb.insert(roles).values({
      id: nanoid(),
      userId: params.userId,
      role: 'teacher',
      groupIds: [params.groupId],
      createdBy: params.createdBy,
    });
    return;
  }

  const current = Array.isArray(teacherRole.groupIds) ? teacherRole.groupIds : [];
  const next = [...new Set([...current, params.groupId])];
  await openpathDb
    .update(roles)
    .set({ groupIds: next as unknown as string[] })
    .where(eq(roles.id, teacherRole.id));
}

export async function removeGroupFromTeacherRole(params: {
  userId: string;
  groupId: string;
}): Promise<void> {
  const existingRoles = await openpathDb
    .select()
    .from(roles)
    .where(eq(roles.userId, params.userId));
  const teacherRole = existingRoles.find((role) => role.role === 'teacher');
  if (!teacherRole || !Array.isArray(teacherRole.groupIds)) return;

  const next = teacherRole.groupIds.filter((groupId) => groupId !== params.groupId);
  await openpathDb
    .update(roles)
    .set({ groupIds: next as unknown as string[] })
    .where(eq(roles.id, teacherRole.id));
}
