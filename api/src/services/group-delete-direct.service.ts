import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  notifyOpenPathGroupChanged,
  openpathDb,
  whitelistGroups,
  whitelistRules,
} from '../db/openpath.js';
import { assertCanUseGroup } from '../lib/tenant-access.js';
import { runMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { getMutationResult, getOrCreateMutationOperation } from '../lib/cross-system-mutations.js';
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

  const operation = await getOrCreateMutationOperation({
    operationType: 'groups.delete_group',
    idempotencyKey: `${params.organizationId}:${params.groupId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { groupId: params.groupId, userRole: params.userRole ?? null },
  });

  if (operation.status === 'completed') {
    return { success: true };
  }

  await runMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true; groupId: string }>(operation),
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    steps: [
      {
        step: 'local_committed',
        shouldRun: ({ result }) => !result,
        run: async () => {
          await db
            .delete(schema.cpOrganizationGroups)
            .where(
              and(
                eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
                eq(schema.cpOrganizationGroups.groupId, params.groupId)
              )
            );

          return {
            result: { success: true, groupId: params.groupId },
          };
        },
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: async ({ result }) => {
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
            result: result ?? { success: true, groupId: params.groupId },
          };
        },
      },
    ],
  });

  return { success: true };
}
