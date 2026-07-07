import { getGroupsByIds } from '../db/openpath-repos/groups.repo.js';
import {
  getRuleGroupIdsAndTypesByGroupIds,
  type WhitelistRuleRow,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import { getAccessibleTenantGroupIds } from '../lib/tenant-access.js';
import { EMPTY_RULE_COUNTS, type RuleCounts } from './presenters.js';

export type GroupActor = {
  organizationId: string;
  userId: string;
  userRole: string;
};

function buildRuleCountsByGroupId(
  rules: readonly Pick<WhitelistRuleRow, 'groupId' | 'type'>[]
): Map<string, RuleCounts> {
  const map = new Map<string, RuleCounts>();

  for (const rule of rules) {
    const current = map.get(rule.groupId) ?? { ...EMPTY_RULE_COUNTS };

    if (rule.type === 'whitelist') {
      current.whitelistCount += 1;
    } else if (rule.type === 'blocked_subdomain') {
      current.blockedSubdomainCount += 1;
    } else if (rule.type === 'blocked_path') {
      current.blockedPathCount += 1;
    }

    map.set(rule.groupId, current);
  }

  return map;
}

export async function fetchRuleCountsForGroupIds(
  groupIds: readonly string[]
): Promise<Map<string, RuleCounts>> {
  if (groupIds.length === 0) return new Map();

  const rules = await getRuleGroupIdsAndTypesByGroupIds(groupIds);

  return buildRuleCountsByGroupId(rules);
}

export async function fetchTenantGroupsByIds(groupIds: readonly string[]) {
  return getGroupsByIds(groupIds);
}

export async function getTeacherVisibleGroupIds(params: GroupActor) {
  return getAccessibleTenantGroupIds({
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: params.userRole,
  });
}
