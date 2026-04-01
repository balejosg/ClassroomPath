import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  notifyOpenPathGroupChanged,
  openpathDb,
  publishWhitelistGroupChanged,
  publishWhitelistGroupsChanged,
  roles,
  whitelistGroups,
  whitelistRules,
} from '../db/openpath.js';
import {
  assertCanAccessGroup,
  assertCanUseGroup,
  getAccessibleTenantGroupIds,
  toOpenPathEnabledFlag,
} from '../lib/tenant-access.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
  toMutationError,
} from '../lib/cross-system-mutations.js';
import { normalizeGroupKey, scopedGroupNameForOrg } from './group-name.service.js';
import { presentTenantGroupMutation } from './presenters.js';

export type GroupRuleSeed = Pick<typeof whitelistRules.$inferSelect, 'type' | 'value' | 'comment'>;

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole?: string;
};

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

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

async function deleteOpenPathGroupCascade(groupId: string): Promise<void> {
  await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, groupId));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, groupId));
}

export async function createOrganizationGroupFromRules(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  publicName: string;
  displayName: string;
  enabled?: number | boolean;
  visibility?: string;
  rules: GroupRuleSeed[];
}): Promise<{
  group: typeof whitelistGroups.$inferSelect;
  publicName: string;
  visibility: string;
}> {
  const publicName = normalizeGroupKey(params.publicName);
  if (!publicName) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Group name is required' });
  }

  const name = scopedGroupNameForOrg(params.organizationId, publicName);
  const enabled = toOpenPathEnabledFlag(params.enabled ?? 1);
  const visibility = params.visibility ?? 'private';
  const operation = await getOrCreateMutationOperation({
    operationType: 'groups.create_group',
    idempotencyKey: `${params.organizationId}:${publicName}`,
    organizationId: params.organizationId,
    userId: params.actorUserId,
    metadata: {
      actorRole: params.actorRole ?? null,
      displayName: params.displayName,
      enabled,
      publicName,
      rules: params.rules,
      visibility,
    },
  });

  const storedResult = getMutationResult<{
    groupId: string;
    publicName: string;
    visibility: string;
  }>(operation);

  if (operation.status === 'completed' && storedResult) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ya existe un grupo con ese identificador (slug)',
    });
  }

  let group = storedResult
    ? (
        await openpathDb
          .select()
          .from(whitelistGroups)
          .where(eq(whitelistGroups.id, storedResult.groupId))
          .limit(1)
      )[0]
    : undefined;

  if (!storedResult) {
    const groupId = nanoid();
    try {
      group = await openpathDb.transaction(async (tx) => {
        const [created] = await tx
          .insert(whitelistGroups)
          .values({
            id: groupId,
            name,
            displayName: params.displayName,
            enabled,
          })
          .returning();

        if (params.rules.length > 0) {
          await tx.insert(whitelistRules).values(
            params.rules.map((rule) => ({
              id: nanoid(),
              groupId: created.id,
              type: rule.type,
              value: rule.value,
              comment: rule.comment,
            }))
          );
        }

        return created;
      });

      await setMutationOperationProgress(operation.id, {
        step: 'upstream_created',
        status: 'in_progress',
        organizationId: params.organizationId,
        result: { groupId: group.id, publicName, visibility },
        lastError: null,
      });
    } catch (err) {
      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        lastError: toMutationError(err),
      });
      throwConflictOnUniqueViolation(err, 'Ya existe un grupo con ese identificador (slug)');
      throw err;
    }
  }

  if (!group) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create group' });
  }

  try {
    const existingLink = await db
      .select({ id: schema.cpOrganizationGroups.id })
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
          eq(schema.cpOrganizationGroups.groupId, group.id)
        )
      )
      .limit(1);

    if (existingLink.length === 0) {
      await db.insert(schema.cpOrganizationGroups).values({
        id: nanoid(),
        organizationId: params.organizationId,
        groupId: group.id,
        publicName,
        visibility,
      });
    }

    await setMutationOperationProgress(operation.id, {
      step: 'local_linked',
      status: 'in_progress',
      organizationId: params.organizationId,
      result: { groupId: group.id, publicName, visibility },
      lastError: null,
    });

    if (params.actorRole === 'teacher') {
      await addGroupToTeacherRole({
        userId: params.actorUserId,
        groupId: group.id,
        createdBy: params.actorUserId,
      });
    }

    await publishWhitelistGroupChanged(group.id);

    await setMutationOperationProgress(operation.id, {
      step: 'completed',
      status: 'completed',
      organizationId: params.organizationId,
      result: { groupId: group.id, publicName, visibility },
      lastError: null,
      completed: true,
    });
  } catch (err) {
    await setMutationOperationProgress(operation.id, {
      step: 'failed',
      status: 'failed',
      organizationId: params.organizationId,
      result: { groupId: group.id, publicName, visibility },
      lastError: toMutationError(err),
    });
    throwConflictOnUniqueViolation(err, 'Ya existe un grupo con ese identificador (slug)');
    throw err;
  }

  return { group, publicName, visibility };
}

export async function createOrganizationGroup(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  name: string;
  displayName: string;
  enabled?: number | boolean;
}) {
  const created = await createOrganizationGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    publicName: params.name,
    displayName: params.displayName,
    enabled: params.enabled,
    rules: [],
  });

  return presentTenantGroupMutation({
    group: created.group,
    publicName: created.publicName,
  });
}

export async function updateOrganizationGroup(
  params: GroupActor & {
    groupId: string;
    displayName?: string;
    enabled?: number | boolean;
    visibility?: string;
  }
) {
  await assertCanAccessGroup(
    {
      organizationId: params.organizationId,
      userRole: params.userRole,
      user: { sub: params.userId },
    },
    params.groupId,
    'edit',
    GROUP_PERMISSION_OPTS
  );

  const orgGroup = await db
    .select({ publicName: schema.cpOrganizationGroups.publicName })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
        eq(schema.cpOrganizationGroups.groupId, params.groupId)
      )
    )
    .limit(1);

  const updateData: {
    updatedAt: Date;
    displayName?: string;
    enabled?: number;
  } = {
    updatedAt: new Date(),
  };

  if (params.displayName !== undefined) {
    updateData.displayName = params.displayName;
  }

  if (params.enabled !== undefined) {
    updateData.enabled = toOpenPathEnabledFlag(params.enabled);
  }

  if (params.visibility !== undefined) {
    await db
      .update(schema.cpOrganizationGroups)
      .set({ visibility: params.visibility })
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
          eq(schema.cpOrganizationGroups.groupId, params.groupId)
        )
      );
  }

  const [updated] = await openpathDb
    .update(whitelistGroups)
    .set(updateData)
    .where(eq(whitelistGroups.id, params.groupId))
    .returning();

  await notifyOpenPathGroupChanged(updated.id);

  return presentTenantGroupMutation({
    group: updated,
    publicName: orgGroup[0]?.publicName ?? undefined,
  });
}

export async function deleteOrganizationGroup(params: GroupActor & { groupId: string }) {
  await assertCanUseGroup(
    {
      organizationId: params.organizationId,
      userRole: params.userRole,
      user: { sub: params.userId },
    },
    params.groupId,
    GROUP_PERMISSION_OPTS
  );

  const operation = await getOrCreateMutationOperation({
    operationType: 'groups.delete_group',
    idempotencyKey: `${params.organizationId}:${params.groupId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { groupId: params.groupId, userRole: params.userRole ?? null },
  });

  if (operation.status !== 'completed') {
    if (Object.keys(operation.result).length === 0) {
      await db
        .delete(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
            eq(schema.cpOrganizationGroups.groupId, params.groupId)
          )
        );

      await setMutationOperationProgress(operation.id, {
        step: 'local_committed',
        status: 'in_progress',
        result: { success: true, groupId: params.groupId },
        lastError: null,
      });
    }

    try {
      const stillReferenced = await db
        .select({ id: schema.cpOrganizationGroups.id })
        .from(schema.cpOrganizationGroups)
        .where(eq(schema.cpOrganizationGroups.groupId, params.groupId))
        .limit(1);

      if (stillReferenced.length === 0) {
        await deleteOpenPathGroupCascade(params.groupId);

        if (params.userRole === 'teacher') {
          await removeGroupFromTeacherRole({ userId: params.userId, groupId: params.groupId });
        }

        await notifyOpenPathGroupChanged(params.groupId);
      }

      await setMutationOperationProgress(operation.id, {
        step: 'completed',
        status: 'completed',
        result: { success: true, groupId: params.groupId },
        lastError: null,
        completed: true,
      });
    } catch (err) {
      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        result: { success: true, groupId: params.groupId },
        lastError: toMutationError(err),
      });
      throw err;
    }
  }

  return { success: true };
}

export async function bulkDeleteOrganizationGroupRules(params: GroupActor & { ids: string[] }) {
  const rulesToDelete = await openpathDb
    .select()
    .from(whitelistRules)
    .where(inArray(whitelistRules.id, params.ids));

  if (rulesToDelete.length === 0) {
    return { rules: [], deleted: 0 };
  }

  const accessibleGroupIds = new Set(
    await getAccessibleTenantGroupIds({
      organizationId: params.organizationId,
      userId: params.userId,
      userRole: params.userRole,
    })
  );

  const accessibleRules = rulesToDelete.filter((rule) => accessibleGroupIds.has(rule.groupId));

  if (accessibleRules.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No accessible rules found' });
  }

  const accessibleIds = accessibleRules.map((rule) => rule.id);
  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, accessibleIds));

  const affectedGroupIds = [...new Set(accessibleRules.map((rule) => rule.groupId))];
  await publishWhitelistGroupsChanged(affectedGroupIds);

  return {
    rules: accessibleRules.map((rule) => ({
      id: rule.id,
      groupId: rule.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
      createdAt: rule.createdAt?.toISOString() ?? null,
    })),
    deleted: accessibleRules.length,
  };
}
