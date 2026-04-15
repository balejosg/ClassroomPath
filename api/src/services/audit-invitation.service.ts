import { recordAuditEvent } from './audit-core.service.js';

export async function recordInvitationCreatedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
  email: string;
  name: string;
  role: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'invitation.created',
    targetType: 'invitation',
    targetId: params.invitationId,
    metadata: {
      email: params.email,
      name: params.name,
      role: params.role,
    },
  });
}

export async function recordInvitationRevokedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
  email: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'invitation.revoked',
    targetType: 'invitation',
    targetId: params.invitationId,
    metadata: {
      email: params.email,
    },
  });
}
