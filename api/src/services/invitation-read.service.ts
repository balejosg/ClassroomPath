import { and, eq, gt } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  hashInvitationToken,
  OrganizationInvitationDetails,
  OrganizationInvitationSummary,
  toInvitationSummary,
  toIsoStringOrNull,
} from './invitation-shared.service.js';

export async function listOrganizationInvitations(
  organizationId: string
): Promise<OrganizationInvitationSummary[]> {
  const rows = await db
    .select({
      id: schema.cpInvitations.id,
      organizationId: schema.cpInvitations.organizationId,
      email: schema.cpInvitations.email,
      name: schema.cpInvitations.name,
      role: schema.cpInvitations.role,
      createdAt: schema.cpInvitations.createdAt,
      expiresAt: schema.cpInvitations.expiresAt,
    })
    .from(schema.cpInvitations)
    .where(
      and(
        eq(schema.cpInvitations.organizationId, organizationId),
        gt(schema.cpInvitations.expiresAt, new Date())
      )
    );

  return rows.map((row) => toInvitationSummary(row));
}

export async function getInvitationByToken(
  token: string
): Promise<OrganizationInvitationDetails | null> {
  const tokenHash = hashInvitationToken(token);
  const [invitation] = await db
    .select({
      id: schema.cpInvitations.id,
      organizationId: schema.cpInvitations.organizationId,
      organizationName: schema.cpOrganizations.name,
      email: schema.cpInvitations.email,
      name: schema.cpInvitations.name,
      role: schema.cpInvitations.role,
      invitedBy: schema.cpInvitations.invitedBy,
      createdAt: schema.cpInvitations.createdAt,
      expiresAt: schema.cpInvitations.expiresAt,
    })
    .from(schema.cpInvitations)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpOrganizations.id, schema.cpInvitations.organizationId)
    )
    .where(eq(schema.cpInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    return null;
  }

  if (invitation.expiresAt <= new Date()) {
    await db.delete(schema.cpInvitations).where(eq(schema.cpInvitations.id, invitation.id));
    return null;
  }

  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: invitation.organizationName,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role === 'admin' ? 'admin' : 'teacher',
    invitedBy: invitation.invitedBy,
    createdAt: toIsoStringOrNull(invitation.createdAt),
    expiresAt: invitation.expiresAt.toISOString(),
    status: 'Pending',
  };
}
