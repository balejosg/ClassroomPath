import { getPersistedUserRole } from './organization-user-helpers.js';
import { presentUserRole } from './presenters.js';
import type { AssignedRoleResult } from './organization-user-role-assignment-workflow.service.js';

export async function presentAssignedOrganizationUserRole(params: {
  userId: string;
  fallback: AssignedRoleResult;
}) {
  const persistedRole = await getPersistedUserRole(params.userId);

  return presentUserRole({
    role: persistedRole,
    fallback: {
      userId: params.userId,
      role: params.fallback.role,
      groupIds: params.fallback.groupIds,
      createdBy: params.fallback.createdBy,
    },
  });
}
