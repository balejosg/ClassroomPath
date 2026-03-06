import { openpathDb, openpathSchema } from '../db/openpath.js';
import { eq, inArray } from 'drizzle-orm';

export interface User {
  id: string;
  email: string;
  name: string;
}

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
