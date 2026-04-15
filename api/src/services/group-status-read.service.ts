import { inArray } from 'drizzle-orm';

import { openpathDb, whitelistRules } from '../db/openpath.js';
import { isOpenPathGroupEnabled } from '../lib/tenant-access.js';
import {
  fetchTenantGroupsByIds,
  getTeacherVisibleGroupIds,
  type GroupActor,
} from './group-read-shared.service.js';

export async function getOrganizationGroupStats(params: GroupActor) {
  const groupIds = await getTeacherVisibleGroupIds(params);

  if (groupIds.length === 0) {
    return { groupCount: 0, whitelistCount: 0, blockedCount: 0 };
  }

  const rules = await openpathDb
    .select({ type: whitelistRules.type })
    .from(whitelistRules)
    .where(inArray(whitelistRules.groupId, groupIds));

  const whitelistCount = rules.filter((rule) => rule.type === 'whitelist').length;
  const blockedCount = rules.filter(
    (rule) => rule.type === 'blocked_subdomain' || rule.type === 'blocked_path'
  ).length;

  return {
    groupCount: groupIds.length,
    whitelistCount,
    blockedCount,
  };
}

export async function getOrganizationSystemStatus(params: GroupActor) {
  const groupIds = await getTeacherVisibleGroupIds(params);

  if (groupIds.length === 0) {
    return {
      enabled: false,
      totalGroups: 0,
      activeGroups: 0,
      pausedGroups: 0,
      enabledGroups: 0,
      disabledGroups: 0,
    };
  }

  const groups = await fetchTenantGroupsByIds(groupIds);
  const enabledGroups = groups.filter((group) => isOpenPathGroupEnabled(group.enabled)).length;
  const disabledGroups = groups.length - enabledGroups;

  return {
    enabled: enabledGroups > 0,
    totalGroups: groups.length,
    activeGroups: enabledGroups,
    pausedGroups: disabledGroups,
    enabledGroups,
    disabledGroups,
  };
}
