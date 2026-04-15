import {
  createOrganizationInvitation,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
} from './invitations.service.js';

export async function createOrganizationUser(params: {
  organizationId: string;
  actedBy: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
}) {
  return createOrganizationInvitation({
    organizationId: params.organizationId,
    invitedBy: params.actedBy,
    email: params.email,
    name: params.name,
    role: params.role,
  });
}

export { listOrganizationInvitations, revokeOrganizationInvitation };
