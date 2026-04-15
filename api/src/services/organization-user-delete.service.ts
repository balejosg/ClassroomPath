import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { runMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getMutationResult, getOrCreateMutationOperation } from '../lib/cross-system-mutations.js';
import { recordUserDeletedAuditEvent } from './audit.service.js';
import {
  assertManagedOrganizationUser,
  assertOrganizationAdminSurvivability,
} from './organization-user-helpers.js';

export async function deleteOrganizationUser(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
}) {
  await assertManagedOrganizationUser(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: null,
  });

  const operation = await getOrCreateMutationOperation({
    operationType: 'users.delete_organization_user',
    idempotencyKey: `${params.organizationId}:${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    metadata: { actedBy: params.actedBy },
  });

  const storedResult = getMutationResult<{ success: true; role: string | null }>(operation);
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return { success: true };
  }

  const workflow = await runMutationWorkflow({
    operation,
    initialResult: localResult,
    initialState: { syncedUpstream: operation.currentStep === 'synced_upstream' },
    metadata: operation.metadata as Record<string, unknown>,
    steps: [
      {
        step: 'local_committed',
        shouldRun: () => true,
        run: async () => {
          const [membership] = await db
            .select({ role: schema.cpMemberships.role })
            .from(schema.cpMemberships)
            .where(
              and(
                eq(schema.cpMemberships.organizationId, params.organizationId),
                eq(schema.cpMemberships.userId, params.userId)
              )
            )
            .limit(1);

          await db.transaction(async (tx) => {
            await tx
              .delete(schema.cpOrganizationUsers)
              .where(
                and(
                  eq(schema.cpOrganizationUsers.organizationId, params.organizationId),
                  eq(schema.cpOrganizationUsers.openpathUserId, params.userId)
                )
              );

            await tx
              .delete(schema.cpMemberships)
              .where(
                and(
                  eq(schema.cpMemberships.organizationId, params.organizationId),
                  eq(schema.cpMemberships.userId, params.userId)
                )
              );
          });

          const membershipRole = membership?.role ?? null;

          return {
            result: { success: true as const, role: membershipRole },
          };
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

          if (result.role) {
            await recordUserDeletedAuditEvent({
              organizationId: params.organizationId,
              actorUserId: params.actedBy,
              userId: params.userId,
              role: result.role,
            });
          }

          return { result };
        },
      },
    ],
  });

  localResult = workflow.result;

  return { success: true };
}
