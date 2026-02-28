import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';

export function isOrgAdmin(ctx: { userRole?: string }): boolean {
  return ctx.userRole === 'admin';
}

export function requireTeacherOrAdmin(ctx: { userRole?: string }): void {
  if (ctx.userRole !== 'admin' && ctx.userRole !== 'teacher') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Teacher access required' });
  }
}

export type OpenPathEnabledInput = number | boolean;

export function toOpenPathEnabledFlag(value: OpenPathEnabledInput): 0 | 1 {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value === 1 ? 1 : 0;
}

export function isOpenPathGroupEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return false;
}

export type GroupAccessLevel = 'view' | 'edit';

export async function assertOrgGroupAccess(organizationId: string, groupId: string): Promise<void> {
  const orgGroup = await db
    .select({ id: schema.cpOrganizationGroups.id })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, organizationId),
        eq(schema.cpOrganizationGroups.groupId, groupId)
      )
    )
    .limit(1);

  if (!orgGroup.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Group not found or access denied',
    });
  }
}

export async function assertOrgClassroomAccess(
  organizationId: string,
  classroomId: string
): Promise<void> {
  const orgClassroom = await db
    .select({ id: schema.cpOrganizationClassrooms.id })
    .from(schema.cpOrganizationClassrooms)
    .where(
      and(
        eq(schema.cpOrganizationClassrooms.organizationId, organizationId),
        eq(schema.cpOrganizationClassrooms.classroomId, classroomId)
      )
    )
    .limit(1);

  if (!orgClassroom.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Classroom not found or access denied',
    });
  }
}

export async function getTeacherGroupIdentifiers(userId: string): Promise<Set<string>> {
  const rows = await openpathDb
    .select({ role: openpathSchema.roles.role, groupIds: openpathSchema.roles.groupIds })
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, userId));

  const identifiers = new Set<string>();
  for (const r of rows) {
    if (r.role !== 'teacher') continue;
    if (!Array.isArray(r.groupIds)) continue;
    for (const gid of r.groupIds) {
      if (typeof gid !== 'string') continue;
      const trimmed = gid.trim();
      if (trimmed) identifiers.add(trimmed);
    }
  }
  return identifiers;
}

export async function teacherCanUseGroup(params: {
  userId: string;
  groupId: string;
}): Promise<boolean> {
  const identifiers = await getTeacherGroupIdentifiers(params.userId);
  if (identifiers.has(params.groupId)) return true;

  // Backwards-compatible: role.groupIds may store group names.
  const group = await openpathDb
    .select({ id: openpathSchema.whitelistGroups.id, name: openpathSchema.whitelistGroups.name })
    .from(openpathSchema.whitelistGroups)
    .where(eq(openpathSchema.whitelistGroups.id, params.groupId))
    .limit(1);

  return !!group[0] && identifiers.has(group[0].name);
}

export async function assertCanUseGroup(
  ctx: { organizationId?: string; userRole?: string; user: { sub: string } },
  groupId: string,
  opts?: { notTeacherMessage?: string; notAllowedMessage?: string }
): Promise<void> {
  await assertCanAccessGroup(ctx, groupId, 'edit', opts);

  const row = await openpathDb
    .select({ enabled: openpathSchema.whitelistGroups.enabled })
    .from(openpathSchema.whitelistGroups)
    .where(eq(openpathSchema.whitelistGroups.id, groupId))
    .limit(1);

  const enabledValue = row[0]?.enabled;
  const enabled = isOpenPathGroupEnabled(enabledValue);
  if (!enabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No puedes usar un grupo inactivo',
    });
  }
}

export async function assertCanViewGroup(
  ctx: { organizationId?: string; userRole?: string; user: { sub: string } },
  groupId: string,
  opts?: { notTeacherMessage?: string; notAllowedMessage?: string }
): Promise<void> {
  await assertCanAccessGroup(ctx, groupId, 'view', opts);
}

export async function assertCanAccessGroup(
  ctx: { organizationId?: string; userRole?: string; user: { sub: string } },
  groupId: string,
  access: GroupAccessLevel,
  opts?: { notTeacherMessage?: string; notAllowedMessage?: string }
): Promise<void> {
  requireTeacherOrAdmin(ctx);
  const organizationId = ctx.organizationId;
  if (!organizationId) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Missing organizationId' });
  }

  const orgGroup = await db
    .select({ visibility: schema.cpOrganizationGroups.visibility })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, organizationId),
        eq(schema.cpOrganizationGroups.groupId, groupId)
      )
    )
    .limit(1);

  if (!orgGroup.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Group not found or access denied',
    });
  }

  if (isOrgAdmin(ctx)) return;

  if (ctx.userRole !== 'teacher') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: opts?.notTeacherMessage ?? 'Teacher access required',
    });
  }

  if (access === 'view' && orgGroup[0].visibility === 'instance_public') return;

  const ok = await teacherCanUseGroup({ userId: ctx.user.sub, groupId });
  if (!ok) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: opts?.notAllowedMessage ?? 'You can only use your assigned groups',
    });
  }
}

export async function getAccessibleTenantGroupIds(params: {
  organizationId: string;
  userRole?: string;
  userId: string;
}): Promise<string[]> {
  const orgGroups = await db
    .select({ groupId: schema.cpOrganizationGroups.groupId })
    .from(schema.cpOrganizationGroups)
    .where(eq(schema.cpOrganizationGroups.organizationId, params.organizationId));

  const groupIds = orgGroups.map((group) => group.groupId);
  if (groupIds.length === 0) return [];

  if (params.userRole === 'admin') return groupIds;
  if (params.userRole !== 'teacher') return [];

  const identifiers = await getTeacherGroupIdentifiers(params.userId);
  if (identifiers.size === 0) return [];

  const groups = await openpathDb
    .select({ id: openpathSchema.whitelistGroups.id, name: openpathSchema.whitelistGroups.name })
    .from(openpathSchema.whitelistGroups)
    .where(inArray(openpathSchema.whitelistGroups.id, groupIds));

  return groups.filter((g) => identifiers.has(g.id) || identifiers.has(g.name)).map((g) => g.id);
}
