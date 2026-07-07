import {
  deleteRuleAndPublish,
  updateRuleAndPublish,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
} from './group-rules-read.service.js';

// Thin service facade over the owning repository (see group-rules-create).

export async function deleteGroupRule(params: { id: string; groupId: string }): Promise<boolean> {
  return deleteRuleAndPublish(params);
}

export async function updateGroupRule(params: {
  id: string;
  groupId: string;
  value?: string;
  comment?: string | null;
}): Promise<{ rule: SerializedWhitelistRule; valueChanged: boolean }> {
  const { row, valueChanged } = await updateRuleAndPublish(params);
  return {
    rule: serializeWhitelistRule(row),
    valueChanged,
  };
}
