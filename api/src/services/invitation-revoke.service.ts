import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { recordInvitationRevokedAuditEvent } from './audit.service.js';

export async function revokeOrganizationInvitation(params: {
  organizationId: string;
  invitationId: string;
  actedBy: string;
}): Promise<{ success: true }> {
  const deleted = await db
    .delete(schema.cpInvitations)
    .where(
      and(
        eq(schema.cpInvitations.organizationId, params.organizationId),
        eq(schema.cpInvitations.id, params.invitationId)
      )
    )
    .returning({
      id: schema.cpInvitations.id,
      email: schema.cpInvitations.email,
    });

  if (deleted.length === 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Invitation not found',
    });
  }

  await recordInvitationRevokedAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actedBy,
    invitationId: deleted[0].id,
    email: deleted[0].email,
  });

  return { success: true };
}
