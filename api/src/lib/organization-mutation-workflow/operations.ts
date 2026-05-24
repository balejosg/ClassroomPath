import {
  getOrCreateMutationOperation,
  type MutationOperationRecord,
} from '../cross-system-mutations.js';
import { buildOrganizationMutationOperation } from './catalog.js';
import type { OrganizationBusinessMutation } from './types.js';

export async function getOrCreateOrganizationMutationOperation(
  mutation: OrganizationBusinessMutation
): Promise<MutationOperationRecord> {
  const facts = buildOrganizationMutationOperation(mutation);

  return getOrCreateMutationOperation({
    operationType: facts.operationType,
    idempotencyKey: facts.idempotencyKey,
    organizationId: facts.organizationId,
    userId: facts.userId,
    metadata: facts.metadata,
  });
}
