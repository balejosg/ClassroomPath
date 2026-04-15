import {
  assertManagedOrganizationUser,
  assertOrganizationAdminSurvivability,
} from './organization-user-helpers.js';
import { presentAssignedOrganizationUserRole } from './organization-user-role-assignment-presenter.service.js';
import { assignOrganizationUserRoleWorkflow } from './organization-user-role-assignment-workflow.service.js';

export async function assignOrganizationUserRole(params: {
  organizationId: string;
  userId: string;
  actedBy: string;
  role: 'admin' | 'teacher';
  groupIds: string[];
}) {
  await assertManagedOrganizationUser(params);
  await assertOrganizationAdminSurvivability({
    organizationId: params.organizationId,
    userId: params.userId,
    nextRole: params.role,
  });
  const finalRole = await assignOrganizationUserRoleWorkflow(params);

  return presentAssignedOrganizationUserRole({
    userId: params.userId,
    fallback: finalRole,
  });
}
