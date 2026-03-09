import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import { config } from '../config.js';
import {
  assertNoExistingMembershipOrThrow,
  getSingleMembershipOrThrow,
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
} from '../lib/tenant-memberships.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';

export interface OnboardingStatus {
  hasMembership: boolean;
  isWaiting: boolean;
  organization: {
    id: string;
    name: string;
    role: string;
  } | null;
  policy: OnboardingPolicy;
}

export interface OnboardingPolicy {
  allowSelfServiceOrgs: boolean;
  allowOrgDirectory: boolean;
}

export function getOnboardingPolicy(): OnboardingPolicy {
  return {
    allowSelfServiceOrgs: config.allowSelfServiceOrgs,
    allowOrgDirectory: config.allowOrgDirectory,
  };
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const policy = getOnboardingPolicy();
  const membership = await getSingleMembershipOrThrow(userId);
  if (membership) {
    const [organization] = await db
      .select({
        id: schema.cpOrganizations.id,
        name: schema.cpOrganizations.name,
      })
      .from(schema.cpOrganizations)
      .where(eq(schema.cpOrganizations.id, membership.organizationId))
      .limit(1);

    return {
      hasMembership: true,
      isWaiting: false,
      organization: {
        id: membership.organizationId,
        name: organization?.name ?? membership.organizationId,
        role: membership.role,
      },
      policy,
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
    policy,
  };
}

export async function assertCanStartOnboarding(userId: string): Promise<void> {
  await assertNoExistingMembershipOrThrow(userId);
}

export async function createOrganization(
  name: string,
  userId: string
): Promise<{ organizationId: string; membershipId: string }> {
  await assertCanStartOnboarding(userId);

  const orgId = generateId('org');
  const membershipId = generateId('mem');

  try {
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
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
  }

  await synchronizeOpenPathRole({
    userId,
    actedBy: userId,
    groupIds: [],
  });

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
