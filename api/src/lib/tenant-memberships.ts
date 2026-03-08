import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';

export const SINGLE_ORG_MEMBERSHIP_MESSAGE =
  'Users must belong to a single organization before creating or accepting another membership';
export const AMBIGUOUS_TENANT_CONTEXT_MESSAGE =
  'Ambiguous tenant context: user belongs to multiple organizations';

export function getMembershipConflictMessage(membershipCount: number): string {
  return membershipCount > 1 ? AMBIGUOUS_TENANT_CONTEXT_MESSAGE : SINGLE_ORG_MEMBERSHIP_MESSAGE;
}

export function throwMembershipConflict(membershipCount: number): never {
  throw new TRPCError({
    code: 'CONFLICT',
    message: getMembershipConflictMessage(membershipCount),
  });
}

export async function listMembershipsForUser(
  userId: string
): Promise<Array<typeof schema.cpMemberships.$inferSelect>> {
  return db
    .select()
    .from(schema.cpMemberships)
    .where(eq(schema.cpMemberships.userId, userId))
    .limit(2);
}

export async function getSingleMembershipOrThrow(
  userId: string
): Promise<typeof schema.cpMemberships.$inferSelect | null> {
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length > 1) {
    throwMembershipConflict(memberships.length);
  }

  return memberships[0] ?? null;
}

export async function assertNoExistingMembershipOrThrow(userId: string): Promise<void> {
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length > 0) {
    throwMembershipConflict(memberships.length);
  }
}
