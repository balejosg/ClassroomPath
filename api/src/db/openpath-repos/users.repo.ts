import { eq, inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../openpath.js';

// Owning module for users-table access (folded from lib/openpath-users.ts,
// plus the write statements from user-update and auth-registration). No notify
// pairing: user rows are auth/directory state, not agent-facing policy (F5).
// Two update methods exist because the two call sites differ in RETURNING --
// the repo preserves each statement chain exactly (plan F14).

export interface User {
  id: string;
  email: string;
  name: string;
}

export type UserRow = typeof openpathSchema.users.$inferSelect;
export type NewUser = typeof openpathSchema.users.$inferInsert;

export async function getUserById(id: string): Promise<User | null> {
  const result = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.id, id))
    .limit(1);

  return result[0] ?? null;
}

export async function getUserNamesByIds(userIds: readonly string[]): Promise<Map<string, string>> {
  const uniqueIds = [
    ...new Set(userIds.filter((userId) => typeof userId === 'string' && userId.trim().length > 0)),
  ];
  const map = new Map<string, string>();

  if (uniqueIds.length === 0) {
    return map;
  }

  const rows = await openpathDb
    .select({
      id: openpathSchema.users.id,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(inArray(openpathSchema.users.id, uniqueIds));

  for (const row of rows) {
    map.set(row.id, row.name);
  }

  return map;
}

export async function findUserIdById(id: string): Promise<string | undefined> {
  const [row] = await openpathDb
    .select({ id: openpathSchema.users.id })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.id, id))
    .limit(1);
  return row?.id;
}

export async function updateUser(
  userId: string,
  set: Partial<Pick<NewUser, 'googleId' | 'emailVerified' | 'updatedAt'>>
): Promise<void> {
  await openpathDb.update(openpathSchema.users).set(set).where(eq(openpathSchema.users.id, userId));
}

export async function updateUserReturning(
  userId: string,
  set: Partial<Pick<NewUser, 'name' | 'isActive'>>
): Promise<UserRow | undefined> {
  const [updated] = await openpathDb
    .update(openpathSchema.users)
    .set(set)
    .where(eq(openpathSchema.users.id, userId))
    .returning();
  return updated;
}

export async function insertUser(values: NewUser): Promise<UserRow | undefined> {
  // Preserves auth-registration.service.ts's original insert chain exactly
  // (plan F14): concurrent Google sign-ups can race on the email/googleId
  // unique constraints, and the caller relies on a silent no-op (falling
  // back to a lookup of the existing row) rather than a thrown DB error.
  const [created] = await openpathDb
    .insert(openpathSchema.users)
    .values(values)
    .onConflictDoNothing()
    .returning();
  return created;
}
