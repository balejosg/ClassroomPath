import { nanoid } from 'nanoid';

import {
  deleteRolesByUserId,
  getRoleByUserId,
  getRolesByUserId,
  insertRole,
  updateRoleByUserIdReturning,
} from '../db/openpath-repos/roles.repo.js';
import { findUserIdById } from '../db/openpath-repos/users.repo.js';
import { listMembershipsForUser, throwMembershipConflict } from './tenant-memberships.js';

// Cross-system role synchronization: maps the single CP membership onto the
// mirrored OpenPath role row. Stays out of db/openpath-repos because it
// consumes CP membership logic (tenant-memberships) -- repos are mirror-only.
// All mirror statements are delegated to roles.repo/users.repo.

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

async function resolveRoleCreatorId(params: { userId: string; actedBy: string }): Promise<string> {
  if (params.actedBy === params.userId) {
    return params.userId;
  }

  const actorId = await findUserIdById(params.actedBy);
  return actorId ?? params.userId;
}

export async function getUserRoles(userId: string): Promise<RoleInfo[]> {
  const result = await getRolesByUserId(userId);

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
    await deleteRolesByUserId(params.userId);
    return null;
  }

  const existingRole = await getRoleByUserId(params.userId);

  const mirroredRole = toMirroredOpenPathRole(membership.role);
  const nextGroupIds =
    params.groupIds !== undefined
      ? normalizeGroupIds(params.groupIds)
      : normalizeGroupIds(existingRole?.groupIds);

  if (existingRole === undefined) {
    const createdBy = await resolveRoleCreatorId({
      userId: params.userId,
      actedBy: params.actedBy,
    });

    await insertRole({
      id: nanoid(),
      userId: params.userId,
      role: mirroredRole,
      groupIds: nextGroupIds,
      createdBy,
    });

    return {
      role: mirroredRole,
      groupIds: nextGroupIds,
    };
  }

  const updated = await updateRoleByUserIdReturning(params.userId, {
    role: mirroredRole,
    groupIds: nextGroupIds,
  });

  return {
    role: updated.role as RoleInfo['role'],
    groupIds: normalizeGroupIds(updated.groupIds),
  };
}
