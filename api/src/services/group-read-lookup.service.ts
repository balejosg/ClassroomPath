import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, whitelistGroups } from '../db/openpath.js';
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
    openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, params.groupId))
      .limit(1),
  ]);

  if (!group[0]) return null;

  return presentTenantGroupLookup({
    group: group[0],
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
    const legacyGroup = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.name, params.name))
      .limit(1);

    if (!legacyGroup.length) return null;

    const legacyOrgGroup = await db
      .select({
        publicName: schema.cpOrganizationGroups.publicName,
        groupId: schema.cpOrganizationGroups.groupId,
      })
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, params.organizationId),
          eq(schema.cpOrganizationGroups.groupId, legacyGroup[0].id)
        )
      )
      .limit(1);

    if (!legacyOrgGroup.length) return null;

    if (!isOrgAdmin({ userRole: params.userRole })) {
      const identifiers = await getTeacherGroupIdentifiers(params.userId);
      if (!identifiers.has(legacyGroup[0].id) && !identifiers.has(legacyGroup[0].name)) {
        return null;
      }
    }

    return presentTenantGroupLookup({
      group: legacyGroup[0],
      publicName: legacyOrgGroup[0].publicName ?? legacyGroup[0].name,
    });
  }

  const group = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(eq(whitelistGroups.id, orgGroup[0].groupId))
    .limit(1);

  if (!group.length) return null;

  if (!isOrgAdmin({ userRole: params.userRole })) {
    const identifiers = await getTeacherGroupIdentifiers(params.userId);
    if (!identifiers.has(group[0].id) && !identifiers.has(group[0].name)) {
      return null;
    }
  }

  return presentTenantGroupLookup({
    group: group[0],
    publicName: orgGroup[0].publicName ?? undefined,
  });
}
