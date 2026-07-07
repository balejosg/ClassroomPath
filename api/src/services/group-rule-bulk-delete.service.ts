import { TRPCError } from '@trpc/server';

import {
  deleteRulesByIdsAndPublishGroups,
  getRulesByIds,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import { getAccessibleTenantGroupIds } from '../lib/tenant-access.js';

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole?: string;
};

export async function bulkDeleteOrganizationGroupRules(params: GroupActor & { ids: string[] }) {
  const rulesToDelete = await getRulesByIds(params.ids);

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
  const affectedGroupIds = [...new Set(accessibleRules.map((rule) => rule.groupId))];
  await deleteRulesByIdsAndPublishGroups({ ruleIds: accessibleIds, groupIds: affectedGroupIds });

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
