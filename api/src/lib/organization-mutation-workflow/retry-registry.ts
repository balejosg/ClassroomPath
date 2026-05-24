import { organizationMutationRetryAdapters } from './retry-adapters.js';
import type {
  OrganizationMutationOperationType,
  OrganizationMutationRetryHandler,
} from './types.js';

export const organizationMutationRetryHandlers = organizationMutationRetryAdapters as Partial<
  Record<OrganizationMutationOperationType, OrganizationMutationRetryHandler>
>;

export function getOrganizationMutationRetryHandler(
  operationType: string
): OrganizationMutationRetryHandler | undefined {
  return organizationMutationRetryHandlers[operationType as OrganizationMutationOperationType];
}
