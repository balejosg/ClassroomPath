import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

export async function orgHasGroup(params: {
  organizationId: string;
  groupId: string;
}): Promise<boolean> {
  const row = await db
    .select({ id: schema.cpOrganizationGroups.id })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
        eq(schema.cpOrganizationGroups.groupId, params.groupId)
      )
    )
    .limit(1);

  return row.length > 0;
}
