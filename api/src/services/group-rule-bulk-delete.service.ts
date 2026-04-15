import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';

import { openpathDb, publishWhitelistGroupsChanged, whitelistRules } from '../db/openpath.js';
import { getAccessibleTenantGroupIds } from '../lib/tenant-access.js';

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole?: string;
};

export async function bulkDeleteOrganizationGroupRules(params: GroupActor & { ids: string[] }) {
  const rulesToDelete = await openpathDb
    .select()
    .from(whitelistRules)
    .where(inArray(whitelistRules.id, params.ids));

  if (rulesToDelete.length === 0) {
    return { rules: [], deleted: 0 };
  }

  const accessibleGroupIds = new Set(
    await getAccessibleTenantGroupIds({
      organizationId: params.organizationId,
      userId: params.userId,
      userRole: params.userRole,
    })
  );

  const accessibleRules = rulesToDelete.filter((rule) => accessibleGroupIds.has(rule.groupId));

  if (accessibleRules.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No accessible rules found' });
  }

  const accessibleIds = accessibleRules.map((rule) => rule.id);
  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, accessibleIds));

  const affectedGroupIds = [...new Set(accessibleRules.map((rule) => rule.groupId))];
  await publishWhitelistGroupsChanged(affectedGroupIds);

  return {
    rules: accessibleRules.map((rule) => ({
      id: rule.id,
      groupId: rule.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
      createdAt: rule.createdAt?.toISOString() ?? null,
    })),
    deleted: accessibleRules.length,
  };
}
