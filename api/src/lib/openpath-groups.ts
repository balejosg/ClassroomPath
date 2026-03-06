import { inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../db/openpath.js';

export async function getGroupDisplayNamesByIds(
  groupIds: readonly string[]
): Promise<Map<string, string>> {
  const uniqueIds = [
    ...new Set(
      groupIds.filter((groupId) => typeof groupId === 'string' && groupId.trim().length > 0)
    ),
  ];
  const map = new Map<string, string>();

  if (uniqueIds.length === 0) {
    return map;
  }

  const rows = await openpathDb
    .select({
      id: openpathSchema.whitelistGroups.id,
      name: openpathSchema.whitelistGroups.name,
      displayName: openpathSchema.whitelistGroups.displayName,
    })
    .from(openpathSchema.whitelistGroups)
    .where(inArray(openpathSchema.whitelistGroups.id, uniqueIds));

  for (const row of rows) {
    map.set(row.id, row.displayName?.trim() || row.name);
  }

  return map;
}
