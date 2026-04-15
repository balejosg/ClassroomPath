import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { runMutationWorkflow } from '../lib/cross-system-workflow-engine.js';
import { getMutationResult, getOrCreateMutationOperation } from '../lib/cross-system-mutations.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import { SINGLE_ORG_MEMBERSHIP_MESSAGE } from '../lib/tenant-memberships.js';
import { assertCanStartOnboarding } from './onboarding-status.service.js';

export async function createOrganization(
  name: string,
  userId: string
): Promise<{ organizationId: string; membershipId: string }> {
  const operation = await getOrCreateMutationOperation({
    operationType: 'onboarding.create_organization',
    idempotencyKey: userId,
    userId,
    metadata: { name },
  });

  const storedResult = getMutationResult<{ organizationId: string; membershipId: string }>(
    operation
  );
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return localResult;
  }

  try {
    const workflow = await runMutationWorkflow({
      operation,
      initialResult: localResult,
      initialState: { organizationId: localResult?.organizationId ?? null },
      metadata: {
        ...(operation.metadata as Record<string, unknown>),
        name,
      },
      steps: [
        {
          step: 'local_committed',
          shouldRun: ({ result }) => !result,
          run: async () => {
            await assertCanStartOnboarding(userId);

            const organizationId = generateId('org');
            const membershipId = generateId('mem');

            await db.transaction(async (tx) => {
              await tx.insert(schema.cpOrganizations).values({
                id: organizationId,
                name,
                createdBy: userId,
              });

              await tx.insert(schema.cpMemberships).values({
                id: membershipId,
                userId,
                organizationId,
                role: 'admin',
                invitedBy: null,
              });

              await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
            });

            return {
              organizationId,
              result: { organizationId, membershipId },
              state: { organizationId },
            };
          },
        },
        {
          step: 'completed',
          completed: true,
          shouldRun: ({ result }) => Boolean(result),
          run: async ({ result, state }) => {
            if (!result) {
              return;
            }

            await synchronizeOpenPathRole({
              userId,
              actedBy: userId,
              groupIds: [],
            });

            return {
              organizationId: state.organizationId,
              result,
            };
          },
        },
      ],
    });

    localResult = workflow.result;
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    throw error;
  }

  if (!localResult) {
    throw new Error('Onboarding workflow completed without a result');
  }

  return localResult;
}
