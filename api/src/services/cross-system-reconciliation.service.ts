import { TRPCError } from '@trpc/server';

import type { CrossSystemMutationStatus } from '../lib/cross-system-mutations.js';
import { listMutationOperations } from '../lib/cross-system-mutations.js';
import { getOrganizationMutationRetryHandler } from './cross-system-mutation-workflows.js';

export async function listOrganizationMutationOperations(params: {
  organizationId: string;
  status?: CrossSystemMutationStatus;
}) {
  const operations = await listMutationOperations({
    organizationId: params.organizationId,
    status: params.status,
  });

  return operations.map((operation) => ({
    id: operation.id,
    operationType: operation.operationType,
    status: operation.status,
    currentStep: operation.currentStep,
    organizationId: operation.organizationId,
    userId: operation.userId,
    metadata: operation.metadata,
    result: operation.result,
    lastError: operation.lastError,
  }));
}

export async function retryOrganizationMutationOperation(params: {
  organizationId: string;
  operationId: string;
  actedBy: string;
}) {
  const [operation] = (
    await listMutationOperations({ organizationId: params.organizationId })
  ).filter((item) => item.id === params.operationId);

  if (!operation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Mutation operation not found' });
  }

  const handler = getOrganizationMutationRetryHandler(operation.operationType);

  if (!handler) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Retry not supported for ${operation.operationType}`,
    });
  }

  return handler({
    operation,
    organizationId: params.organizationId,
    actedBy: params.actedBy,
  });
}
