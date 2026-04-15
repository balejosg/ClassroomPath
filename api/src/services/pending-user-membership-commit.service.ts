import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { throwMembershipConflict } from '../lib/tenant-memberships.js';

export async function commitPendingUserMembership(params: {
  userId: string;
  organizationId: string;
  role: 'admin' | 'teacher';
  approvedBy: string;
}): Promise<{ membershipId: string }> {
  const membershipId = generateId('mem');

  await db.transaction(async (tx) => {
    const status = await tx
      .select()
      .from(schema.cpUserStatus)
      .where(
        and(
          eq(schema.cpUserStatus.userId, params.userId),
          eq(schema.cpUserStatus.status, 'waiting'),
          eq(schema.cpUserStatus.targetOrganizationId, params.organizationId)
        )
      )
      .limit(1);

    if (status.length === 0) {
      throw new Error('User is not waiting for this organization');
    }

    const existingMemberships = await tx
      .select({
        organizationId: schema.cpMemberships.organizationId,
      })
      .from(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, params.userId))
      .limit(2);

    if (existingMemberships.length > 0) {
      throwMembershipConflict(existingMemberships.length);
    }

    await tx.insert(schema.cpMemberships).values({
      id: membershipId,
      userId: params.userId,
      organizationId: params.organizationId,
      role: params.role,
      invitedBy: params.approvedBy,
    });

    await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, params.userId));
  });

  return { membershipId };
}
