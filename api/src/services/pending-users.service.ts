import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { recordPendingUserRejectedAuditEvent } from './audit.service.js';
export { approveUser } from './pending-user-approval.service.js';
import {
  listWaitingUsersForOrganization,
  setWaitingStatusWithOrg as upsertWaitingStatusWithOrg,
  type WaitingUser,
} from './waiting-status.service.js';

export type PendingUser = WaitingUser;

/**
 * List all users waiting to join a specific organization
 */
export async function listPendingUsers(organizationId: string): Promise<PendingUser[]> {
  return listWaitingUsersForOrganization(organizationId);
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
  await upsertWaitingStatusWithOrg(userId, targetOrganizationId);
}
