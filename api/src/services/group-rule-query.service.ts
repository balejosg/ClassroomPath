import { and, eq } from 'drizzle-orm';

import { openpathDb, whitelistRules } from '../db/openpath.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
  type WhitelistRuleSource,
  type WhitelistRuleType,
} from './group-rule-serialization.service.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;

export async function loadGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
  source?: WhitelistRuleSource;
}): Promise<OpenPathWhitelistRule[]> {
  const conditions = [eq(whitelistRules.groupId, params.groupId)];
  if (params.type) {
    conditions.push(eq(whitelistRules.type, params.type));
  }
  if (params.source) {
    conditions.push(eq(whitelistRules.source, params.source));
  }

  return openpathDb
    .select()
    .from(whitelistRules)
    .where(and(...conditions));
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
  source?: WhitelistRuleSource;
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
