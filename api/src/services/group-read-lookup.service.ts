import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getGroupById } from '../db/openpath-repos/groups.repo.js';
import { getTeacherGroupIdentifiers, isOrgAdmin } from '../lib/tenant-access.js';
import { normalizeGroupKey } from './group-name.service.js';
import { presentTenantGroupLookup } from './presenters.js';

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole: string;
};

export async function getOrganizationGroupById(params: {
  organizationId: string;
  groupId: string;
}) {
  const [orgGroup, group] = await Promise.all([
    db
      .select({
        publicName: schema.cpOrganizationGroups.publicName,
      })
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
          eq(schema.cpOrganizationGroups.groupId, params.groupId)
        )
      )
      .limit(1),
    getGroupById(params.groupId),
  ]);

  if (!group) return null;

  return presentTenantGroupLookup({
    group,
    publicName: orgGroup[0]?.publicName ?? undefined,
  });
}

export async function getOrganizationGroupByName(params: GroupActor & { name: string }) {
  const publicName = normalizeGroupKey(params.name);
  const orgGroup = await db
    .select({
      groupId: schema.cpOrganizationGroups.groupId,
      publicName: schema.cpOrganizationGroups.publicName,
    })
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
        eq(schema.cpOrganizationGroups.publicName, publicName)
      )
    )
    .limit(1);

  if (!orgGroup.length) {
    return null;
  }

  const group = await getGroupById(orgGroup[0].groupId);

  if (!group) return null;

  if (!isOrgAdmin({ userRole: params.userRole })) {
    const identifiers = await getTeacherGroupIdentifiers(params.userId);
    if (!identifiers.has(group.id)) {
      return null;
    }
  }

  return presentTenantGroupLookup({
    group,
    publicName: orgGroup[0].publicName ?? undefined,
  });
}
