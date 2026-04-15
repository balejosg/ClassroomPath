import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { isOrgAdmin } from '../lib/tenant-access.js';
import {
  fetchRuleCountsForGroupIds,
  fetchTenantGroupsByIds,
  getTeacherVisibleGroupIds,
  type GroupActor,
} from './group-read-shared.service.js';
import { presentTenantGroupSummary } from './presenters.js';

type OrganizationGroupMeta = Pick<
  typeof schema.cpOrganizationGroups.$inferSelect,
  'groupId' | 'publicName' | 'visibility'
>;

function indexOrgGroupMeta(
  rows: readonly OrganizationGroupMeta[]
): Map<string, OrganizationGroupMeta> {
  return new Map(rows.map((row) => [row.groupId, row]));
}

async function presentOrganizationGroups(orgGroups: readonly OrganizationGroupMeta[]) {
  const groupIds = orgGroups.map((row) => row.groupId);
  if (groupIds.length === 0) return [];

  const [groups, ruleCounts] = await Promise.all([
    fetchTenantGroupsByIds(groupIds),
    fetchRuleCountsForGroupIds(groupIds),
  ]);
  const orgGroupMetaById = indexOrgGroupMeta(orgGroups);

  return groups.map((group) =>
    presentTenantGroupSummary({
      group,
      publicName: orgGroupMetaById.get(group.id)?.publicName ?? undefined,
      visibility: orgGroupMetaById.get(group.id)?.visibility ?? 'private',
      counts: ruleCounts.get(group.id),
    })
  );
}

export async function listOrganizationGroups(params: GroupActor) {
  const orgGroups = await db
    .select()
    .from(schema.cpOrganizationGroups)
    .where(eq(schema.cpOrganizationGroups.organizationId, params.organizationId));

  const groupIds = orgGroups.map((row) => row.groupId);
  if (groupIds.length === 0) return [];

  const visibleGroupIds = isOrgAdmin({ userRole: params.userRole })
    ? groupIds
    : await getTeacherVisibleGroupIds(params);

  if (visibleGroupIds.length === 0) return [];

  return presentOrganizationGroups(
    orgGroups.filter((row) => visibleGroupIds.includes(row.groupId))
  );
}

export async function listOrganizationLibraryGroups(organizationId: string) {
  const orgGroups = await db
    .select()
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, organizationId),
        eq(schema.cpOrganizationGroups.visibility, 'instance_public')
      )
    );

  return presentOrganizationGroups(orgGroups);
}
