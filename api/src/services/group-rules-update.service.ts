import { and, eq } from 'drizzle-orm';

import { openpathDb, whitelistRules } from '../db/openpath.js';
import {
  serializeWhitelistRule,
  type SerializedWhitelistRule,
} from './group-rules-read.service.js';

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
