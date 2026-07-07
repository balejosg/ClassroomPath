import {
  getRulesByGroupId,
  type WhitelistRuleRow,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
  type WhitelistRuleType,
} from './group-rule-serialization.service.js';

export async function loadGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
}): Promise<WhitelistRuleRow[]> {
  return getRulesByGroupId(params.groupId, params.type);
}

export async function listGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
}): Promise<SerializedWhitelistRule[]> {
  const rules = await loadGroupRules(params);
  return rules.map(serializeWhitelistRule);
}

export async function listPaginatedGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
  limit: number;
  offset: number;
  search?: string;
}): Promise<{ rules: SerializedWhitelistRule[]; total: number; hasMore: boolean }> {
  const allRules = await loadGroupRules(params);

  let filteredRules = allRules;
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filteredRules = allRules.filter(
      (rule) =>
        rule.value.toLowerCase().includes(searchLower) ||
        (rule.comment && rule.comment.toLowerCase().includes(searchLower))
    );
  }

  const total = filteredRules.length;
  const paginatedRules = filteredRules.slice(params.offset, params.offset + params.limit);

  return {
    rules: paginatedRules.map(serializeWhitelistRule),
    total,
    hasMore: params.offset + params.limit < total,
  };
}
