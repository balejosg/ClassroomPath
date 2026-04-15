import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { runMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getMutationResult, getOrCreateMutationOperation } from '../lib/cross-system-mutations.js';
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
  const operation = await getOrCreateMutationOperation({
    operationType: 'users.revoke_role',
    idempotencyKey: `${params.organizationId}:${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { actedBy: params.actedBy },
  });

  if (operation.status === 'completed') {
    return { success: true };
  }

  await runMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true }>(operation),
    initialState: { syncedUpstream: operation.currentStep === 'synced_upstream' },
    metadata: operation.metadata as Record<string, unknown>,
    steps: [
      {
        step: 'local_committed',
        shouldRun: () => true,
        run: async () => {
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

          return { result: { success: true } };
        },
      },
      {
        step: 'synced_upstream',
        shouldRun: ({ result, state }) => Boolean(result) && !state.syncedUpstream,
        run: async ({ result }) => {
          if (!result) {
            return;
          }

          await synchronizeOpenPathRole({
            userId: params.userId,
            actedBy: params.actedBy,
            groupIds: [],
          });

          return {
            result,
            state: (current) => ({ ...current, syncedUpstream: true }),
          };
        },
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: async ({ result }) => {
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
      },
    ],
  });

  return { success: true };
}
