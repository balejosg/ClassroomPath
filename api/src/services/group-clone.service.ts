import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../db/openpath.js';
import * as schema from '../db/schema.js';
import { apiCopy } from '../lib/api-content.js';
import { isOpenPathGroupEnabled } from '../lib/tenant-access.js';
import { createOrganizationGroupFromRules } from './group-write.service.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;
type RuleSeed = Pick<OpenPathWhitelistRule, 'type' | 'value' | 'comment'>;

export async function cloneGroupIntoOrganization(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  sourceGroupId: string;
  name?: string;
  displayName?: string;
}): Promise<{ id: string; name: string }> {
  const source = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, params.sourceGroupId))
    .limit(1);

  if (!source[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  }

  if (!isOpenPathGroupEnabled(source[0].enabled)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: apiCopy.en.errors.inactiveGroupClone,
    });
  }

  const sourceOrgGroup = await db
    .select({ publicName: schema.cpOrganizationGroups.publicName })
    .from(schema.cpOrganizationGroups)
    .where(eq(schema.cpOrganizationGroups.groupId, params.sourceGroupId))
    .limit(1);

  const publicName =
    params.name?.trim() ||
    sourceOrgGroup[0]?.publicName ||
    source[0].displayName?.trim() ||
    source[0].name;

  const rawDisplayName = params.displayName?.trim();
  const displayName =
    rawDisplayName ||
    `${source[0].displayName || sourceOrgGroup[0]?.publicName || source[0].name} Copia`;

  const sourceRules: RuleSeed[] = await openpathDb
    .select({
      type: whitelistRules.type,
      value: whitelistRules.value,
      comment: whitelistRules.comment,
    })
    .from(whitelistRules)
    .where(eq(whitelistRules.groupId, source[0].id));

  const { group, publicName: createdPublicName } = await createOrganizationGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    publicName,
    displayName,
    rules: sourceRules,
  });

  return { id: group.id, name: createdPublicName };
}
