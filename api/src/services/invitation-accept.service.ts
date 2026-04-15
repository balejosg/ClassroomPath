import { eq, and } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { generateId } from '../lib/id.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
  throwMembershipConflict,
} from '../lib/tenant-memberships.js';

export async function acceptOrganizationInvitation(params: {
  invitationId: string;
  organizationId: string;
  userId: string;
  invitedBy: string;
  role: 'admin' | 'teacher';
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const existingMemberships = await tx
        .select({ organizationId: schema.cpMemberships.organizationId })
        .from(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, params.userId))
        .limit(2);

      if (existingMemberships.length > 0) {
        throwMembershipConflict(existingMemberships.length);
      }

      await tx.insert(schema.cpMemberships).values({
        id: generateId('mem'),
        userId: params.userId,
        organizationId: params.organizationId,
        role: params.role,
        invitedBy: params.invitedBy,
      });

      await tx
        .delete(schema.cpInvitations)
        .where(
          and(
            eq(schema.cpInvitations.id, params.invitationId),
            eq(schema.cpInvitations.organizationId, params.organizationId)
          )
        );
    });
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    throw error;
  }
}
