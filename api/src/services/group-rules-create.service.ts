import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, whitelistRules } from '../db/openpath.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
  type WhitelistRuleType,
} from './group-rules-read.service.js';

export async function createOrReuseGroupRule(input: {
  groupId: string;
  type: WhitelistRuleType;
  value: string;
  comment?: string;
}): Promise<SerializedWhitelistRule & { created: boolean }> {
  const insertResult = await openpathDb
    .insert(whitelistRules)
    .values({
      id: nanoid(),
      groupId: input.groupId,
      type: input.type,
      value: input.value,
      comment: input.comment,
    })
    .onConflictDoNothing({
      target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
    })
    .returning();

  if (insertResult.length > 0) {
    return {
      ...serializeWhitelistRule(insertResult[0]),
      created: true,
    };
  }

  const existingRule = await openpathDb
    .select()
    .from(whitelistRules)
    .where(
      and(
        eq(whitelistRules.groupId, input.groupId),
        eq(whitelistRules.type, input.type),
        eq(whitelistRules.value, input.value)
      )
    )
    .limit(1);

  if (existingRule.length > 0) {
    return {
      ...serializeWhitelistRule(existingRule[0]),
      created: false,
    };
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to create or find rule',
  });
}

export async function bulkCreateGroupRules(params: {
  groupId: string;
  type: WhitelistRuleType;
  values: string[];
}): Promise<number> {
  const insertedRules = await openpathDb
    .insert(whitelistRules)
    .values(
      params.values.map((value) => ({
        id: nanoid(),
        groupId: params.groupId,
        type: params.type,
        value,
      }))
    )
    .onConflictDoNothing({
      target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
    })
    .returning();

  return insertedRules.length;
}
