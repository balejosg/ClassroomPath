import { openpathDb, openpathSchema } from '../db/openpath.js';
import { eq } from 'drizzle-orm';

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
