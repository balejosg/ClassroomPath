import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
  throwMembershipConflict,
} from '../lib/tenant-memberships.js';

export interface PendingUser {
  userId: string;
  email: string;
  name: string;
  createdAt: Date | null;
}

/**
 * List all users waiting to join a specific organization
 */
export async function listPendingUsers(organizationId: string): Promise<PendingUser[]> {
  // Get all users with waiting status for this organization
  const waitingUsers = await db
    .select({
      userId: schema.cpUserStatus.userId,
      createdAt: schema.cpUserStatus.createdAt,
    })
    .from(schema.cpUserStatus)
    .where(
      and(
        eq(schema.cpUserStatus.status, 'waiting'),
        eq(schema.cpUserStatus.targetOrganizationId, organizationId)
      )
    );

  if (waitingUsers.length === 0) {
    return [];
  }

  // Get user details from OpenPath
  const userIds = waitingUsers.map((u) => u.userId);
  const openpathUsers = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(inArray(openpathSchema.users.id, userIds));

  const userMap = new Map(openpathUsers.map((u) => [u.id, u]));

  return waitingUsers
    .filter((wu) => userMap.has(wu.userId))
    .map((wu) => {
      const user = userMap.get(wu.userId)!;
      return {
        userId: wu.userId,
        email: user.email,
        name: user.name || user.email,
        createdAt: wu.createdAt,
      };
    });
}

/**
 * Approve a pending user - add them to the organization
 */
export async function approveUser(
  userId: string,
  organizationId: string,
  role: 'admin' | 'teacher',
  approvedBy: string
): Promise<{ membershipId: string }> {
  const membershipId = generateId('mem');

  try {
    await db.transaction(async (tx) => {
      // Verify user is actually waiting for this organization
      const status = await tx
        .select()
        .from(schema.cpUserStatus)
        .where(
          and(
            eq(schema.cpUserStatus.userId, userId),
            eq(schema.cpUserStatus.status, 'waiting'),
            eq(schema.cpUserStatus.targetOrganizationId, organizationId)
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
        .where(eq(schema.cpMemberships.userId, userId))
        .limit(2);

      if (existingMemberships.length > 0) {
        throwMembershipConflict(existingMemberships.length);
      }

      // Create membership
      await tx.insert(schema.cpMemberships).values({
        id: membershipId,
        userId,
        organizationId,
        role,
        invitedBy: approvedBy,
      });

      // Remove waiting status
      await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
    });
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
  }

  await synchronizeOpenPathRole({
    userId,
    actedBy: approvedBy,
    groupIds: [],
  });

  return { membershipId };
}

/**
 * Reject a pending user - remove their waiting status
 */
export async function rejectUser(userId: string, organizationId: string): Promise<void> {
  const result = await db
    .delete(schema.cpUserStatus)
    .where(
      and(
        eq(schema.cpUserStatus.userId, userId),
        eq(schema.cpUserStatus.status, 'waiting'),
        eq(schema.cpUserStatus.targetOrganizationId, organizationId)
      )
    );

  // Note: User will need to request access again or create their own org
}

/**
 * Set waiting status with target organization
 */
export async function setWaitingStatusWithOrg(
  userId: string,
  targetOrganizationId: string
): Promise<void> {
  await db
    .insert(schema.cpUserStatus)
    .values({
      userId,
      status: 'waiting',
      targetOrganizationId,
    })
    .onConflictDoUpdate({
      target: schema.cpUserStatus.userId,
      set: {
        status: 'waiting',
        targetOrganizationId,
        updatedAt: new Date() as any,
      },
    });
}
