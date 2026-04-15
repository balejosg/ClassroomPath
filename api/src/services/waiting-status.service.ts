import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';

export interface WaitingUser {
  userId: string;
  email: string;
  name: string;
  createdAt: Date | null;
}

export async function listWaitingUsersForOrganization(
  organizationId: string
): Promise<WaitingUser[]> {
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

  const userIds = waitingUsers.map((user) => user.userId);
  const openpathUsers = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(inArray(openpathSchema.users.id, userIds));

  const userMap = new Map(openpathUsers.map((user) => [user.id, user]));

  return waitingUsers
    .filter((waitingUser) => userMap.has(waitingUser.userId))
    .map((waitingUser) => {
      const user = userMap.get(waitingUser.userId)!;
      return {
        userId: waitingUser.userId,
        email: user.email,
        name: user.name || user.email,
        createdAt: waitingUser.createdAt,
      };
    });
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

export async function clearWaitingStatus(userId: string): Promise<void> {
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}
