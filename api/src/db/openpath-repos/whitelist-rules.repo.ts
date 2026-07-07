import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, whitelistRules } from '../openpath.js';
import { publishWhitelistGroupChanged, publishWhitelistGroupsChanged } from './publish.js';

// Owning module for all whitelist_rules writes. Every method that changes
// agent-visible rule content performs its mandatory publish (group updated_at
// touch + pg_notify) itself, with the same conditions the call sites used to
// hand-roll: created / insertedCount>0 / valueChanged / deleted. Tenant
// scoping stays in the calling services (ADR 0003) -- this module never sees
// an organizationId.

export type WhitelistRuleRow = typeof whitelistRules.$inferSelect;

export async function createOrReuseRuleAndPublish(input: {
  groupId: string;
  type: WhitelistRuleRow['type'];
  value: string;
  comment?: string;
}): Promise<{ row: WhitelistRuleRow | undefined; created: boolean }> {
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
    await publishWhitelistGroupChanged(input.groupId);
    return { row: insertResult[0], created: true };
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

  return { row: existingRule[0], created: false };
}

export async function bulkCreateRulesAndPublish(params: {
  groupId: string;
  type: WhitelistRuleRow['type'];
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

  if (insertedRules.length > 0) {
    await publishWhitelistGroupChanged(params.groupId);
  }

  return insertedRules.length;
}

export async function updateRuleAndPublish(params: {
  id: string;
  groupId: string;
  value?: string;
  comment?: string | null;
}): Promise<{ row: WhitelistRuleRow; valueChanged: boolean }> {
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

  if (valueChanged) {
    await publishWhitelistGroupChanged(params.groupId);
  }

  return { row: updated, valueChanged };
}

export async function deleteRuleAndPublish(params: {
  id: string;
  groupId: string;
}): Promise<boolean> {
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

  const deleted = (deleteResult.rowCount ?? 0) > 0;
  if (deleted) {
    await publishWhitelistGroupChanged(params.groupId);
  }

  return deleted;
}

export async function getRulesByIds(ruleIds: readonly string[]): Promise<WhitelistRuleRow[]> {
  return openpathDb
    .select()
    .from(whitelistRules)
    .where(inArray(whitelistRules.id, [...ruleIds]));
}

export async function deleteRulesByIdsAndPublishGroups(params: {
  ruleIds: readonly string[];
  groupIds: readonly string[];
}): Promise<void> {
  await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, [...params.ruleIds]));

  await publishWhitelistGroupsChanged(params.groupIds);
}

export async function insertRuleIfAbsentAndPublish(values: {
  id: string;
  groupId: string;
  type: WhitelistRuleRow['type'];
  value: string;
}): Promise<boolean> {
  const inserted = await openpathDb
    .insert(whitelistRules)
    .values(values)
    .onConflictDoNothing({
      target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
    })
    .returning();

  if (inserted.length > 0) {
    await publishWhitelistGroupChanged(values.groupId);
    return true;
  }

  return false;
}
