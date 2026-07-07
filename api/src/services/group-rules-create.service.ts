import { TRPCError } from '@trpc/server';

import {
  bulkCreateRulesAndPublish,
  createOrReuseRuleAndPublish,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
  type WhitelistRuleType,
} from './group-rules-read.service.js';

// Thin service facade over the owning repository. The repository performs the
// write AND its mandatory publish (previously the caller had to remember to
// publish after this function returned). Exported names and signatures are
// unchanged; serialization stays service-side.

export async function createOrReuseGroupRule(input: {
  groupId: string;
  type: WhitelistRuleType;
  value: string;
  comment?: string;
}): Promise<SerializedWhitelistRule & { created: boolean }> {
  const { row, created } = await createOrReuseRuleAndPublish(input);

  if (!row) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create or find rule',
    });
  }

  return {
    ...serializeWhitelistRule(row),
    created,
  };
}

export async function bulkCreateGroupRules(params: {
  groupId: string;
  type: WhitelistRuleType;
  values: string[];
}): Promise<number> {
  return bulkCreateRulesAndPublish(params);
}
