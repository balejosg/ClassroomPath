import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { openpathDb, whitelistGroups, whitelistRules } from '../openpath.js';
import { notifyOpenPathGroupChanged } from './publish.js';

// Owning module for whitelist_groups writes (and the group display-name read
// helper folded in from lib/openpath-groups.ts).
// - updateGroupAndNotify: flavor A -- the UPDATE already stamps updatedAt, so
//   the pairing is a bare notify (not a publish/touch), exactly as
//   group-update.service.ts did. A vanished group returns undefined (no
//   notify) so the caller can raise a clean NOT_FOUND instead of the
//   pre-refactor TypeError (plan F13(b)).
// - createGroupWithRules / deleteGroupCascade: flavor B -- bare writes for the
//   cross-system ledger workflows (ADR 0001), which sequence publish/notify as
//   their own resumable step. Do NOT fold a publish in here; it would change
//   crash/resume semantics.

export type WhitelistGroupRow = typeof whitelistGroups.$inferSelect;
export type GroupRuleSeed = Pick<typeof whitelistRules.$inferSelect, 'type' | 'value' | 'comment'>;

export async function updateGroupAndNotify(
  groupId: string,
  set: { updatedAt: Date; displayName?: string; enabled?: number }
): Promise<WhitelistGroupRow | undefined> {
  const [updated] = await openpathDb
    .update(whitelistGroups)
    .set(set)
    .where(eq(whitelistGroups.id, groupId))
    .returning();

  if (!updated) {
    return undefined;
  }

  await notifyOpenPathGroupChanged(updated.id);
  return updated;
}

export async function createGroupWithRules(params: {
  name: string;
  displayName: string;
  enabled: 0 | 1;
  rules: GroupRuleSeed[];
}): Promise<WhitelistGroupRow> {
  const groupId = nanoid();

  return openpathDb.transaction(async (tx) => {
    const [created] = await tx
      .insert(whitelistGroups)
      .values({
        id: groupId,
        name: params.name,
        displayName: params.displayName,
        enabled: params.enabled,
      })
      .returning();

    if (params.rules.length > 0) {
      await tx.insert(whitelistRules).values(
        params.rules.map((rule) => ({
          id: nanoid(),
          groupId: created.id,
          type: rule.type,
          value: rule.value,
          comment: rule.comment,
        }))
      );
    }

    return created;
  });
}

export async function deleteGroupCascade(groupId: string): Promise<void> {
  await openpathDb.delete(whitelistRules).where(eq(whitelistRules.groupId, groupId));
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, groupId));
}

export async function getGroupById(groupId: string): Promise<WhitelistGroupRow | undefined> {
  const rows = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, groupId))
    .limit(1);
  return rows[0];
}

export async function getGroupDisplayNamesByIds(
  groupIds: readonly string[]
): Promise<Map<string, string>> {
  const uniqueIds = [
    ...new Set(
      groupIds.filter((groupId) => typeof groupId === 'string' && groupId.trim().length > 0)
    ),
  ];
  const map = new Map<string, string>();

  if (uniqueIds.length === 0) {
    return map;
  }

  const rows = await openpathDb
    .select({
      id: whitelistGroups.id,
      name: whitelistGroups.name,
      displayName: whitelistGroups.displayName,
    })
    .from(whitelistGroups)
    .where(inArray(whitelistGroups.id, uniqueIds));

  for (const row of rows) {
    map.set(row.id, row.displayName?.trim() || row.name);
  }

  return map;
}
