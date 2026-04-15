import { recordAuditEvent } from './audit-core.service.js';

export async function recordResetTokenGeneratedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  email: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'user.reset-token-generated',
    targetType: 'user',
    targetId: params.userId,
    metadata: {
      email: params.email,
    },
  });
}

export async function recordPendingUserApprovedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  membershipId: string;
  role: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'pending-user.approved',
    targetType: 'user',
    targetId: params.userId,
    metadata: {
      membershipId: params.membershipId,
      role: params.role,
    },
  });
}

export async function recordPendingUserRejectedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'pending-user.rejected',
    targetType: 'user',
    targetId: params.userId,
    metadata: {},
  });
}

export async function recordUserDeletedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  role: string;
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'user.deleted',
    targetType: 'user',
    targetId: params.userId,
    metadata: {
      role: params.role,
    },
  });
}

export async function recordUserRoleAssignedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  role: string;
  groupIds: string[];
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'user.role-assigned',
    targetType: 'user',
    targetId: params.userId,
    metadata: {
      role: params.role,
      groupIds: params.groupIds,
    },
  });
}

export async function recordUserRoleRevokedAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  role: string;
  groupIds: string[];
}): Promise<string> {
  return recordAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'user.role-revoked',
    targetType: 'user',
    targetId: params.userId,
    metadata: {
      role: params.role,
      groupIds: params.groupIds,
    },
  });
}
