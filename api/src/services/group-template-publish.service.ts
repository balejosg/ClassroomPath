import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../db/index.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../db/openpath.js';
import * as schema from '../db/schema.js';
import { findAvailableTemplateName } from './group-copy-name.service.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;

export async function publishTemplateFromGroup(params: {
  actorUserId: string;
  organizationId?: string;
  groupId: string;
  name?: string;
  displayName?: string;
  description?: string;
}): Promise<{ id: string; name: string }> {
  const sourceGroup = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, params.groupId))
    .limit(1);

  if (!sourceGroup[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  }

  const sourceRules: OpenPathWhitelistRule[] = await openpathDb
    .select()
    .from(whitelistRules)
    .where(eq(whitelistRules.groupId, params.groupId));

  const sourceOrgGroup =
    params.organizationId === undefined
      ? []
      : await db
          .select({ publicName: schema.cpOrganizationGroups.publicName })
          .from(schema.cpOrganizationGroups)
          .where(
            and(
              eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
              eq(schema.cpOrganizationGroups.groupId, params.groupId)
            )
          )
          .limit(1);

  const rawName =
    params.name?.trim() ||
    (sourceOrgGroup[0]?.publicName
      ? `${sourceOrgGroup[0].publicName}-template`
      : sourceGroup[0].displayName?.trim() || `${sourceGroup[0].name}-template`);
  const name = await findAvailableTemplateName(rawName);
  const displayName = params.displayName?.trim() || sourceGroup[0].displayName;

  const templateId = nanoid();

  await db.transaction(async (tx) => {
    await tx.insert(schema.cpGroupTemplates).values({
      id: templateId,
      name,
      displayName,
      description: params.description?.trim() || null,
      createdBy: params.actorUserId,
      updatedAt: new Date(),
    });

    if (sourceRules.length > 0) {
      await tx.insert(schema.cpGroupTemplateRules).values(
        sourceRules.map((r) => ({
          id: nanoid(),
          templateId,
          type: r.type,
          value: r.value,
          comment: r.comment,
        }))
      );
    }
  });

  return { id: templateId, name };
}
