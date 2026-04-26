import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/cross-system-mutation-definitions.js';
import { runLocalFirstMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
import { recordUserRoleRevokedAuditEvent } from './audit.service.js';
import {
  assertManagedOrganizationUser,
  assertOrganizationAdminSurvivability,
} from './organization-user-helpers.js';

export async function revokeOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertManagedOrganizationUser(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: 'teacher',
  });
  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'userRevokeRole',
    organizationId: params.organizationId,
    userId: params.userId,
    actedBy: params.actedBy,
  });

  if (operation.status === 'completed') {
    return { success: true };
  }

  await runLocalFirstMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true }>(operation),
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    localCommitProof: 'current-step',
    commitLocal: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.cpMemberships)
          .set({ role: 'teacher' })
          .where(
            and(
              eq(schema.cpMemberships.organizationId, params.organizationId),
              eq(schema.cpMemberships.userId, params.userId)
            )
          );
      });

      return { result: { success: true as const } };
    },
    syncUpstream: async ({ result }) => {
      if (!result) {
        return;
      }

      await synchronizeOpenPathRole({
        userId: params.userId,
        actedBy: params.actedBy,
        groupIds: [],
      });

      return { result };
    },
    complete: async ({ result }) => {
      if (!result) {
        return;
      }

      await recordUserRoleRevokedAuditEvent({
        organizationId: params.organizationId,
        actorUserId: params.actedBy,
        userId: params.userId,
        role: 'teacher',
        groupIds: [],
      });

      return { result };
    },
  });

  return { success: true };
}
