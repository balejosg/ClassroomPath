import { nanoid } from 'nanoid';

import { openpathDb, whitelistGroups, whitelistRules } from '../db/openpath.js';

export type GroupRuleSeed = Pick<typeof whitelistRules.$inferSelect, 'type' | 'value' | 'comment'>;

export async function createSeededUpstreamGroup(params: {
  name: string;
  displayName: string;
  enabled: 0 | 1;
  rules: GroupRuleSeed[];
}) {
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
