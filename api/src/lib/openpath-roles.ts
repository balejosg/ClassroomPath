import { openpathDb, openpathSchema } from '../db/openpath.js';
import { eq } from 'drizzle-orm';

export interface RoleInfo {
  role: 'admin' | 'teacher';
  groupIds: string[];
}

export async function getUserRoles(userId: string): Promise<RoleInfo[]> {
  const result = await openpathDb
    .select()
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, userId));

  return result.map((r) => ({
    role: r.role as 'admin' | 'teacher',
    groupIds: r.groupIds ?? [],
  }));
}
