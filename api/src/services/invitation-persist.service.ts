import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { apiCopy } from '../lib/api-content.js';
import { generateId } from '../lib/id.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  buildInvitationExpiresAt,
  buildInvitationUrl,
  createInvitationToken,
  getOrganizationOrThrow,
  hashInvitationToken,
} from './invitation-shared.service.js';

export async function createPendingOrganizationInvitationRecord(params: {
  organizationId: string;
  email: string;
  invitedBy: string;
  name: string;
  role: 'admin' | 'teacher';
}) {
  const organization = await getOrganizationOrThrow(params.organizationId);
  const normalizedEmail = params.email.trim().toLowerCase();
  const trimmedName = params.name.trim();
  const invitationId = generateId('inv');

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const invitationUrl = buildInvitationUrl(token);
  const expiresAt = buildInvitationExpiresAt();

  try {
    await db.insert(schema.cpInvitations).values({
      id: invitationId,
      organizationId: params.organizationId,
      email: normalizedEmail,
      name: trimmedName,
      role: params.role,
      tokenHash,
      invitedBy: params.invitedBy,
      expiresAt,
    });
  } catch (error) {
    throwConflictOnUniqueViolation(error, apiCopy.en.errors.activeInvitationExists);
    throw error;
  }

  return {
    expiresAt,
    invitationId,
    invitationUrl,
    normalizedEmail,
    organization,
    trimmedName,
  };
}

export async function deletePendingOrganizationInvitationRecord(params: {
  invitationId: string;
  organizationId: string;
}) {
  await db
    .delete(schema.cpInvitations)
    .where(
      and(
        eq(schema.cpInvitations.organizationId, params.organizationId),
        eq(schema.cpInvitations.id, params.invitationId)
      )
    );
}
