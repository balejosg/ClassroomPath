import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';

export interface OnboardingStatus {
  hasMembership: boolean;
  isWaiting: boolean;
  organization: {
    id: string;
    name: string;
    role: string;
  } | null;
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  // Check for membership
  const membership = await db
    .select({
      orgId: schema.cpMemberships.organizationId,
      role: schema.cpMemberships.role,
      orgName: schema.cpOrganizations.name,
    })
    .from(schema.cpMemberships)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpMemberships.organizationId, schema.cpOrganizations.id)
    )
    .where(eq(schema.cpMemberships.userId, userId))
    .limit(1);

  if (membership.length > 0) {
    return {
      hasMembership: true,
      isWaiting: false,
      organization: {
        id: membership[0].orgId,
        name: membership[0].orgName,
        role: membership[0].role,
      },
    };
  }

  // Check if user is waiting
  const status = await db
    .select()
    .from(schema.cpUserStatus)
    .where(eq(schema.cpUserStatus.userId, userId))
    .limit(1);

  return {
    hasMembership: false,
    isWaiting: status.length > 0 && status[0].status === 'waiting',
    organization: null,
  };
}

export async function createOrganization(
  name: string,
  userId: string
): Promise<{ organizationId: string; membershipId: string }> {
  const orgId = generateId('org');
  const membershipId = generateId('mem');
  const roleId = `role_${generateId('')}`;

  await db.transaction(async (tx) => {
    // Create organization
    await tx.insert(schema.cpOrganizations).values({
      id: orgId,
      name,
      createdBy: userId,
    });

    // Create admin membership for creator
    await tx.insert(schema.cpMemberships).values({
      id: membershipId,
      userId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: null,
    });

    // Remove waiting status if exists
    await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
  });

  // Assign admin role in OpenPath - use upsert to handle unique constraint
  const existing = await openpathDb
    .select()
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    // No role exists - insert new admin role
    await openpathDb.insert(openpathSchema.roles).values({
      id: roleId,
      userId,
      role: 'admin',
      groupIds: [] as string[],
      createdBy: userId,
    });
  } else if (existing[0].role !== 'admin') {
    // Role exists but is not admin - update to admin
    await openpathDb
      .update(openpathSchema.roles)
      .set({ role: 'admin', groupIds: [] as string[] })
      .where(eq(openpathSchema.roles.userId, userId));
  }
  // If already admin, no action needed

  return { organizationId: orgId, membershipId };
}

export async function setWaitingStatus(userId: string): Promise<void> {
  await db
    .insert(schema.cpUserStatus)
    .values({
      userId,
      status: 'waiting',
    })
    .onConflictDoUpdate({
      target: schema.cpUserStatus.userId,
      set: { status: 'waiting', updatedAt: new Date() },
    });
}

export async function clearWaitingStatus(userId: string): Promise<void> {
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}
