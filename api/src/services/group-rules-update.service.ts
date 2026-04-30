import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

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

export async function revokeAutoApprovalRule(params: {
  id: string;
  groupId: string;
  resolvedBy: string;
}): Promise<{ revoked: boolean; blockedRuleId: string | null }> {
  const [existing] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.id, params.id))
    .limit(1);

  if (!existing || existing.groupId !== params.groupId) {
    throw new Error('Rule not found');
  }

  if (existing.type !== 'whitelist' || existing.source !== 'auto_extension') {
    throw new Error('Only automatic whitelist approvals can be revoked this way');
  }

  return openpathDb.transaction(async (tx) => {
    const deleteResult = await tx.delete(whitelistRules).where(eq(whitelistRules.id, params.id));
    const inserted = await tx
      .insert(whitelistRules)
      .values({
        id: nanoid(),
        groupId: params.groupId,
        type: 'blocked_subdomain',
        value: existing.value,
        source: 'manual',
        comment: `Revoked automatic approval by ${params.resolvedBy}`,
      })
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      })
      .returning();

    return {
      blockedRuleId: inserted[0]?.id ?? null,
      revoked: (deleteResult.rowCount ?? 0) > 0,
    };
  });
}
