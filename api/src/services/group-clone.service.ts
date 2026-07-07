import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getGroupById } from '../db/openpath-repos/groups.repo.js';
import {
  getRuleSeedsByGroupId,
  type WhitelistRuleSeed,
} from '../db/openpath-repos/whitelist-rules.repo.js';
import { apiCopy } from '../lib/api-content.js';
import { isOpenPathGroupEnabled } from '../lib/tenant-access.js';
import { createOrganizationGroupFromRules } from './group-write.service.js';

type RuleSeed = WhitelistRuleSeed;

export async function cloneGroupIntoOrganization(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  sourceGroupId: string;
  name?: string;
  displayName?: string;
}): Promise<{ id: string; name: string }> {
  const source = await getGroupById(params.sourceGroupId);

  if (!source) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  }

  if (!isOpenPathGroupEnabled(source.enabled)) {
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
    source.displayName?.trim() ||
    source.name;

  const rawDisplayName = params.displayName?.trim();
  const displayName =
    rawDisplayName || `${source.displayName || sourceOrgGroup[0]?.publicName || source.name} Copia`;

  const sourceRules: RuleSeed[] = await getRuleSeedsByGroupId(source.id);

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
