import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, whitelistGroups } from '../db/openpath.js';
import { notifyOpenPathGroupChanged } from '../db/openpath-repos/publish.js';
import { assertCanAccessGroup, toOpenPathEnabledFlag } from '../lib/tenant-access.js';
import { presentTenantGroupMutation } from './presenters.js';

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole?: string;
};

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

export async function updateOrganizationGroup(
  params: GroupActor & {
    groupId: string;
    displayName?: string;
    enabled?: number | boolean;
    visibility?: string;
  }
) {
  await assertCanAccessGroup(
    {
      organizationId: params.organizationId,
      userRole: params.userRole,
      user: { sub: params.userId },
    },
    params.groupId,
    'edit',
    GROUP_PERMISSION_OPTS
  );

  const orgGroup = await db
    .select({ publicName: schema.cpOrganizationGroups.publicName })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
        eq(schema.cpOrganizationGroups.groupId, params.groupId)
      )
    )
    .limit(1);

  const updateData: {
    updatedAt: Date;
    displayName?: string;
    enabled?: number;
  } = {
    updatedAt: new Date(),
  };

  if (params.displayName !== undefined) {
    updateData.displayName = params.displayName;
  }

  if (params.enabled !== undefined) {
    updateData.enabled = toOpenPathEnabledFlag(params.enabled);
  }

  if (params.visibility !== undefined) {
    await db
      .update(schema.cpOrganizationGroups)
      .set({ visibility: params.visibility })
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
          eq(schema.cpOrganizationGroups.groupId, params.groupId)
        )
      );
  }

  const [updated] = await openpathDb
    .update(whitelistGroups)
    .set(updateData)
    .where(eq(whitelistGroups.id, params.groupId))
    .returning();

  await notifyOpenPathGroupChanged(updated.id);

  return presentTenantGroupMutation({
    group: updated,
    publicName: orgGroup[0]?.publicName ?? undefined,
  });
}
