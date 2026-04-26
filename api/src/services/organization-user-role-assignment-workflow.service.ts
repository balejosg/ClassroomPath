import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/cross-system-mutation-definitions.js';
import { runLocalFirstMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { recordUserRoleAssignedAuditEvent } from './audit.service.js';

type AssignmentParams = {
  organizationId: string;
  userId: string;
  actedBy: string;
  role: 'admin' | 'teacher';
  groupIds: string[];
};

export type AssignedRoleResult = {
  role: 'admin' | 'teacher';
  groupIds: string[];
  createdBy: string;
};

export async function assignOrganizationUserRoleWorkflow(
  params: AssignmentParams
): Promise<AssignedRoleResult> {
  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'userAssignRole',
    organizationId: params.organizationId,
    userId: params.userId,
    actedBy: params.actedBy,
    role: params.role,
    groupIds: [...params.groupIds],
  });

  const storedResult = getMutationResult<AssignedRoleResult>(operation);
  if (operation.status === 'completed' && storedResult) {
    return storedResult;
  }

  const workflow = await runLocalFirstMutationWorkflow({
    operation,
    initialResult: storedResult,
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    localCommitProof: 'current-step',
    commitLocal: async () => {
      const localResult: AssignedRoleResult = {
        role: params.role,
        groupIds: [...params.groupIds],
        createdBy: params.actedBy,
      };

      await db.transaction(async (tx) => {
        await tx
          .update(schema.cpMemberships)
          .set({ role: params.role })
          .where(
            and(
              eq(schema.cpMemberships.organizationId, params.organizationId),
              eq(schema.cpMemberships.userId, params.userId)
            )
          );
      });

      return { result: localResult };
    },
    syncUpstream: async ({ result }) => {
      if (!result) {
        return;
      }

      const synchronizedRole = await synchronizeOpenPathRole({
        userId: params.userId,
        actedBy: params.actedBy,
        groupIds: result.groupIds,
      });

      if (!synchronizedRole) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to synchronize upstream role state',
        });
      }

      return {
        result: {
          role: synchronizedRole.role,
          groupIds: synchronizedRole.groupIds,
          createdBy: params.actedBy,
        },
      };
    },
    complete: async ({ result }) => {
      if (!result) {
        return;
      }

      await recordUserRoleAssignedAuditEvent({
        organizationId: params.organizationId,
        actorUserId: params.actedBy,
        userId: params.userId,
        role: params.role,
        groupIds: [...result.groupIds],
      });

      return { result };
    },
  });

  return (
    workflow.result ?? {
      role: params.role,
      groupIds: [...params.groupIds],
      createdBy: params.actedBy,
    }
  );
}
