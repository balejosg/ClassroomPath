import { whitelistRules } from '../db/openpath.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;

export type WhitelistRuleType = 'whitelist' | 'blocked_subdomain' | 'blocked_path';
export type WhitelistRuleSource = 'manual' | 'auto_extension';

export interface SerializedWhitelistRule {
  id: string;
  groupId: string;
  type: WhitelistRuleType;
  value: string;
  source: WhitelistRuleSource;
  comment: string | null;
  createdAt: string | null;
}

export function serializeWhitelistRule(rule: OpenPathWhitelistRule): SerializedWhitelistRule {
  return {
    id: rule.id,
    groupId: rule.groupId,
    type: rule.type as WhitelistRuleType,
    value: rule.value,
    source: (rule.source as WhitelistRuleSource | null) ?? 'manual',
    comment: rule.comment,
    createdAt: rule.createdAt?.toISOString() ?? null,
  };
}
