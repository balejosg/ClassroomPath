import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/cross-system-mutation-definitions.js';
import { runLocalFirstMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
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

  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'userDelete',
    organizationId: params.organizationId,
    userId: params.userId,
    actedBy: params.actedBy,
  });

  const storedResult = getMutationResult<{ success: true; role: string | null }>(operation);
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return { success: true };
  }

  const workflow = await runLocalFirstMutationWorkflow({
    operation,
    initialResult: localResult,
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    localCommitProof: 'current-step',
    commitLocal: async () => {
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

      await db
        .delete(schema.cpMemberships)
        .where(
          and(
            eq(schema.cpMemberships.organizationId, params.organizationId),
            eq(schema.cpMemberships.userId, params.userId)
          )
        );

      const membershipRole = membership?.role ?? null;

      return {
        result: { success: true as const, role: membershipRole },
      };
    },
    syncUpstream: async ({ result }) => {
      if (!result) {
        return;
      }

      await synchronizeOpenPathRole({
        userId: params.userId,
        actedBy: params.actedBy,
      });

      return { result };
    },
    complete: async ({ result }) => {
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
  });

  localResult = workflow.result;

  return { success: true };
}
