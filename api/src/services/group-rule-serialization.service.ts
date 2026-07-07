import type { WhitelistRuleRow } from '../db/openpath-repos/whitelist-rules.repo.js';

type OpenPathWhitelistRule = WhitelistRuleRow;

export type WhitelistRuleType = 'whitelist' | 'blocked_subdomain' | 'blocked_path' | 'allowed_path';

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
