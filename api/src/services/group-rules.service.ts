import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, whitelistRules } from '../db/openpath.js';
import { getRootDomain } from '../utils/domain.js';

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

function serializeWhitelistRule(rule: OpenPathWhitelistRule): SerializedWhitelistRule {
  return {
    id: rule.id,
    groupId: rule.groupId,
    type: rule.type as WhitelistRuleType,
    value: rule.value,
    comment: rule.comment,
    createdAt: rule.createdAt?.toISOString() ?? null,
  };
}

async function loadGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
}): Promise<OpenPathWhitelistRule[]> {
  const whereConditions = params.type
    ? and(eq(whitelistRules.groupId, params.groupId), eq(whitelistRules.type, params.type))
    : eq(whitelistRules.groupId, params.groupId);

  return openpathDb.select().from(whitelistRules).where(whereConditions);
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

export async function listGroupedGroupRules(params: {
  groupId: string;
  type?: WhitelistRuleType;
  limit: number;
  offset: number;
  search?: string;
}): Promise<{
  groups: Array<{
    root: string;
    rules: SerializedWhitelistRule[];
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

  const groupedMap = new Map<string, OpenPathWhitelistRule[]>();
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

export async function deleteGroupRule(params: { id: string; groupId: string }): Promise<boolean> {
  const [existing] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.id, params.id))
    .limit(1);

  if (!existing || existing.groupId !== params.groupId) {
    throw new Error('Rule not found');
  }

  const deleteResult = await openpathDb
    .delete(whitelistRules)
    .where(eq(whitelistRules.id, params.id));

  return (deleteResult.rowCount ?? 0) > 0;
}

export async function updateGroupRule(params: {
  id: string;
  groupId: string;
  value?: string;
  comment?: string | null;
}): Promise<{ rule: SerializedWhitelistRule; valueChanged: boolean }> {
  const [existing] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.id, params.id));

  if (!existing || existing.groupId !== params.groupId) {
    throw new Error('Rule not found');
  }

  const updates: Partial<{ value: string; comment: string | null }> = {};
  let valueChanged = false;

  if (params.value !== undefined) {
    const normalizedValue = params.value.toLowerCase().trim();

    const [duplicate] = await openpathDb
      .select()
      .from(whitelistRules)
      .where(
        and(
          eq(whitelistRules.groupId, existing.groupId),
          eq(whitelistRules.type, existing.type),
          eq(whitelistRules.value, normalizedValue)
        )
      );

    if (duplicate && duplicate.id !== params.id) {
      throw new Error('A rule with this value already exists');
    }

    if (normalizedValue !== existing.value) {
      updates.value = normalizedValue;
      valueChanged = true;
    }
  }

  if (params.comment !== undefined) {
    updates.comment = params.comment;
  }

  if (Object.keys(updates).length > 0) {
    await openpathDb.update(whitelistRules).set(updates).where(eq(whitelistRules.id, params.id));
  }

  const [updated] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.id, params.id));

  return {
    rule: serializeWhitelistRule(updated),
    valueChanged,
  };
}
