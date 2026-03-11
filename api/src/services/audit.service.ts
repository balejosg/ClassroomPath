import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { generateId } from '../lib/id.js';

type AuditTargetType = 'invitation' | 'user';

interface AuditEventInput<Metadata extends Record<string, unknown>> {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  metadata: Metadata;
}

async function recordAuditEvent<Metadata extends Record<string, unknown>>(
  input: AuditEventInput<Metadata>
): Promise<string> {
  const auditEventId = generateId('audit');

  await db.insert(schema.cpAuditEvents).values({
    id: auditEventId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });

  return auditEventId;
}

export async function deleteAuditEventById(auditEventId: string): Promise<void> {
  await db.delete(schema.cpAuditEvents).where(eq(schema.cpAuditEvents.id, auditEventId));
}

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
