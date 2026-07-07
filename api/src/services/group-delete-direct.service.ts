import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../db/openpath.js';
import { notifyOpenPathGroupChanged } from '../db/openpath-repos/publish.js';
import { assertCanUseGroup } from '../lib/tenant-access.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/organization-mutation-workflow/operations.js';
import { runDeleteMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
import { removeGroupFromTeacherRole } from './group-role-membership.service.js';

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole?: string;
};

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

async function deleteOpenPathGroupCascade(groupId: string): Promise<void> {
  await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, groupId));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, groupId));
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

  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'groupDelete',
    organizationId: params.organizationId,
    userId: params.userId,
    groupId: params.groupId,
    userRole: params.userRole,
  });

  if (operation.status === 'completed') {
    return { success: true };
  }

  await runDeleteMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true; groupId: string }>(operation),
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    commitLocalDelete: async () => {
      await db
        .delete(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
            eq(schema.cpOrganizationGroups.groupId, params.groupId)
          )
        );

      return {
        result: { success: true as const, groupId: params.groupId },
      };
    },
    completeDelete: async ({ result }) => {
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

      return {
        result: result ?? { success: true as const, groupId: params.groupId },
      };
    },
  });

  return { success: true };
}
