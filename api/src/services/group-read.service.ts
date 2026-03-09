import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../db/openpath.js';
import {
  getAccessibleTenantGroupIds,
  getTeacherGroupIdentifiers,
  isOpenPathGroupEnabled,
  isOrgAdmin,
} from '../lib/tenant-access.js';
import { normalizeGroupKey } from './group-name.service.js';
import {
  EMPTY_RULE_COUNTS,
  type RuleCounts,
  presentTenantGroupLookup,
  presentTenantGroupSummary,
} from './presenters.js';

type OrganizationGroupMeta = Pick<
  typeof schema.cpOrganizationGroups.$inferSelect,
  'groupId' | 'publicName' | 'visibility'
>;

type GroupActor = {
  organizationId: string;
  userId: string;
  userRole: string;
};

function indexOrgGroupMeta(
  rows: readonly OrganizationGroupMeta[]
): Map<string, OrganizationGroupMeta> {
  return new Map(rows.map((row) => [row.groupId, row]));
}

function buildRuleCountsByGroupId(
  rules: readonly Pick<typeof whitelistRules.$inferSelect, 'groupId' | 'type'>[]
): Map<string, RuleCounts> {
  const map = new Map<string, RuleCounts>();

  for (const rule of rules) {
    const current = map.get(rule.groupId) ?? { ...EMPTY_RULE_COUNTS };

    if (rule.type === 'whitelist') {
      current.whitelistCount += 1;
    } else if (rule.type === 'blocked_subdomain') {
      current.blockedSubdomainCount += 1;
    } else if (rule.type === 'blocked_path') {
      current.blockedPathCount += 1;
    }

    map.set(rule.groupId, current);
  }

  return map;
}

async function fetchRuleCountsForGroupIds(
  groupIds: readonly string[]
): Promise<Map<string, RuleCounts>> {
  if (groupIds.length === 0) return new Map();

  const rules = await openpathDb
    .select({ groupId: whitelistRules.groupId, type: whitelistRules.type })
    .from(whitelistRules)
    .where(inArray(whitelistRules.groupId, [...groupIds]));

  return buildRuleCountsByGroupId(rules);
}

async function fetchTenantGroupsByIds(groupIds: readonly string[]) {
  if (groupIds.length === 0) return [];

  return openpathDb
    .select()
    .from(whitelistGroups)
    .where(inArray(whitelistGroups.id, [...groupIds]));
}

async function getTeacherVisibleGroupIds(params: GroupActor, groupIds: readonly string[]) {
  if (groupIds.length === 0) return [];

  return getAccessibleTenantGroupIds({
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: params.userRole,
  });
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
    : await getTeacherVisibleGroupIds(params, groupIds);

  if (visibleGroupIds.length === 0) return [];

  const [groups, ruleCounts] = await Promise.all([
    fetchTenantGroupsByIds(visibleGroupIds),
    fetchRuleCountsForGroupIds(visibleGroupIds),
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

export async function getOrganizationGroupStats(params: GroupActor) {
  const groupIds = await getAccessibleTenantGroupIds({
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: params.userRole,
  });

  if (groupIds.length === 0) {
    return { groupCount: 0, whitelistCount: 0, blockedCount: 0 };
  }

  const rules = await openpathDb
    .select({ type: whitelistRules.type })
    .from(whitelistRules)
    .where(inArray(whitelistRules.groupId, groupIds));

  const whitelistCount = rules.filter((rule) => rule.type === 'whitelist').length;
  const blockedCount = rules.filter(
    (rule) => rule.type === 'blocked_subdomain' || rule.type === 'blocked_path'
  ).length;

  return {
    groupCount: groupIds.length,
    whitelistCount,
    blockedCount,
  };
}

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

export async function getOrganizationSystemStatus(params: GroupActor) {
  const groupIds = await getAccessibleTenantGroupIds({
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: params.userRole,
  });

  if (groupIds.length === 0) {
    return {
      enabled: false,
      totalGroups: 0,
      activeGroups: 0,
      pausedGroups: 0,
      enabledGroups: 0,
      disabledGroups: 0,
    };
  }

  const groups = await fetchTenantGroupsByIds(groupIds);
  const enabledGroups = groups.filter((group) => isOpenPathGroupEnabled(group.enabled)).length;
  const disabledGroups = groups.length - enabledGroups;

  return {
    enabled: enabledGroups > 0,
    totalGroups: groups.length,
    activeGroups: enabledGroups,
    pausedGroups: disabledGroups,
    enabledGroups,
    disabledGroups,
  };
}
