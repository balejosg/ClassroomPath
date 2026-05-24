import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import { SINGLE_ORG_MEMBERSHIP_MESSAGE } from '../lib/tenant-memberships.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/organization-mutation-workflow/operations.js';
import { runLocalFirstMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
import { recordPendingUserApprovedAuditEvent } from './audit.service.js';
import { commitPendingUserMembership } from './pending-user-membership-commit.service.js';

export async function approveUser(
  userId: string,
  organizationId: string,
  role: 'admin' | 'teacher',
  approvedBy: string
): Promise<{ membershipId: string }> {
  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'pendingUserApproval',
    organizationId,
    userId,
    role,
    approvedBy,
  });

  const storedResult = getMutationResult<{ membershipId: string }>(operation);
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return localResult;
  }

  try {
    const workflow = await runLocalFirstMutationWorkflow({
      operation,
      initialResult: localResult,
      initialState: {},
      metadata: {
        ...(operation.metadata as Record<string, unknown>),
        role,
        approvedBy,
      },
      commitLocal: async () => {
        const result = await commitPendingUserMembership({
          userId,
          organizationId,
          role,
          approvedBy,
        });

        return { result };
      },
      syncUpstream: async ({ result }) => {
        if (!result) {
          return;
        }

        await synchronizeOpenPathRole({
          userId,
          actedBy: approvedBy,
          groupIds: [],
        });

        return { result };
      },
      complete: async ({ result }) => {
        if (!result) {
          return;
        }

        await recordPendingUserApprovedAuditEvent({
          organizationId,
          actorUserId: approvedBy,
          userId,
          membershipId: result.membershipId,
          role,
        });

        return { result };
      },
    });

    localResult = workflow.result;
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    throw error;
  }

  if (!localResult) {
    throw new Error('Pending user approval completed without a membership result');
  }

  return localResult;
}
