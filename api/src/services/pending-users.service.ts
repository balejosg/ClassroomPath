import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
  throwMembershipConflict,
} from '../lib/tenant-memberships.js';
import {
  recordPendingUserApprovedAuditEvent,
  recordPendingUserRejectedAuditEvent,
} from './audit.service.js';
import {
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
  toMutationError,
} from '../lib/cross-system-mutations.js';

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
  const operation = await getOrCreateMutationOperation({
    operationType: 'pending_users.approve_user',
    idempotencyKey: `${organizationId}:${userId}`,
    organizationId,
    userId,
    metadata: { role, approvedBy },
  });

  const storedResult = getMutationResult<{ membershipId: string }>(operation);
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return localResult;
  }

  if (!localResult) {
    const membershipId = generateId('mem');

    try {
      await db.transaction(async (tx) => {
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

        await tx.insert(schema.cpMemberships).values({
          id: membershipId,
          userId,
          organizationId,
          role,
          invitedBy: approvedBy,
        });

        await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));

        await setMutationOperationProgress(
          operation.id,
          {
            step: 'local_committed',
            status: 'in_progress',
            result: { membershipId },
            metadata: { ...operation.metadata, role, approvedBy },
            lastError: null,
          },
          tx
        );
      });
    } catch (error) {
      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        lastError: toMutationError(error),
      });
      throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    }

    localResult = { membershipId };
  }

  try {
    if (operation.currentStep !== 'synced_upstream' && operation.status !== 'completed') {
      await synchronizeOpenPathRole({
        userId,
        actedBy: approvedBy,
        groupIds: [],
      });

      await setMutationOperationProgress(operation.id, {
        step: 'synced_upstream',
        status: 'in_progress',
        result: localResult,
        lastError: null,
      });
    }

    await recordPendingUserApprovedAuditEvent({
      organizationId,
      actorUserId: approvedBy,
      userId,
      membershipId: localResult.membershipId,
      role,
    });

    await setMutationOperationProgress(operation.id, {
      step: 'completed',
      status: 'completed',
      result: localResult,
      lastError: null,
      completed: true,
    });
  } catch (error) {
    await setMutationOperationProgress(operation.id, {
      step: 'failed',
      status: 'failed',
      result: localResult,
      lastError: toMutationError(error),
    });
    throw error;
  }

  return localResult;
}

/**
 * Reject a pending user - remove their waiting status
 */
export async function rejectUser(
  userId: string,
  organizationId: string,
  rejectedBy: string
): Promise<void> {
  const deleted = await db
    .delete(schema.cpUserStatus)
    .where(
      and(
        eq(schema.cpUserStatus.userId, userId),
        eq(schema.cpUserStatus.status, 'waiting'),
        eq(schema.cpUserStatus.targetOrganizationId, organizationId)
      )
    )
    .returning({ userId: schema.cpUserStatus.userId });

  if (deleted.length === 0) {
    return;
  }

  await recordPendingUserRejectedAuditEvent({
    organizationId,
    actorUserId: rejectedBy,
    userId,
  });

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
