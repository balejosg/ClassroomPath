import { getRootDomain } from '../utils/domain.js';
import { loadGroupRules } from './group-rule-query.service.js';
import {
  serializeWhitelistRule,
  type WhitelistRuleType,
} from './group-rule-serialization.service.js';

export async function listGroupedGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
  limit: number;
  offset: number;
  search?: string;
}): Promise<{
  groups: Array<{
    root: string;
    rules: ReturnType<typeof serializeWhitelistRule>[];
    status: 'mixed' | 'blocked' | 'allowed';
  }>;
  totalGroups: number;
  totalRules: number;
  hasMore: boolean;
}> {
  const allRules = await loadGroupRules(params);

  let filteredRules = allRules;
  if (params.search?.trim()) {
    const searchLower = params.search.toLowerCase().trim();
    filteredRules = allRules.filter((rule) => rule.value.toLowerCase().includes(searchLower));
  }

  const groupedMap = new Map<string, typeof allRules>();
  for (const rule of filteredRules) {
    const root = getRootDomain(rule.value);
    const existing = groupedMap.get(root) ?? [];
    existing.push(rule);
    groupedMap.set(root, existing);
  }

  const sortedRoots = Array.from(groupedMap.keys()).sort((a, b) => a.localeCompare(b));
  const totalGroups = sortedRoots.length;
  const totalRules = filteredRules.length;
  const paginatedRoots = sortedRoots.slice(params.offset, params.offset + params.limit);

  return {
    groups: paginatedRoots.map((root) => {
      const groupRules = groupedMap.get(root) ?? [];
      groupRules.sort((a, b) => a.value.localeCompare(b.value));

      const hasWhitelist = groupRules.some((rule) => rule.type === 'whitelist');
      const hasBlocked = groupRules.some(
        (rule) => rule.type === 'blocked_subdomain' || rule.type === 'blocked_path'
      );

      let status: 'mixed' | 'blocked' | 'allowed';
      if (hasWhitelist && hasBlocked) {
        status = 'mixed';
      } else if (hasBlocked) {
        status = 'blocked';
      } else {
        status = 'allowed';
      }

      return {
        root,
        rules: groupRules.map(serializeWhitelistRule),
        status,
      };
    }),
    totalGroups,
    totalRules,
    hasMore: params.offset + params.limit < totalGroups,
  };
}
