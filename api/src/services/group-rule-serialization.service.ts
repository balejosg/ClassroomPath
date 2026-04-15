import { whitelistRules } from '../db/openpath.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;

export type WhitelistRuleType = 'whitelist' | 'blocked_subdomain' | 'blocked_path';

export interface SerializedWhitelistRule {
  id: string;
  groupId: string;
  type: WhitelistRuleType;
  value: string;
  comment: string | null;
  createdAt: string | null;
}

export function serializeWhitelistRule(rule: OpenPathWhitelistRule): SerializedWhitelistRule {
  return {
    id: rule.id,
    groupId: rule.groupId,
    type: rule.type as WhitelistRuleType,
    value: rule.value,
    comment: rule.comment,
    createdAt: rule.createdAt?.toISOString() ?? null,
  };
}
