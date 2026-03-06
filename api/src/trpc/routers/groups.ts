import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { GroupVisibility as GroupVisibilitySchema } from '@openpath/shared';
import { router, tenantProcedure } from '../trpc.js';
import {
  openpathDb,
  roles,
  whitelistGroups,
  whitelistRules,
  notifyOpenPathGroupChanged,
  publishWhitelistGroupChanged,
  publishWhitelistGroupsChanged,
} from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { throwConflictOnUniqueViolation } from '../../lib/pg-errors.js';

import {
  assertCanAccessGroup,
  assertCanUseGroup,
  assertCanViewGroup,
  getTeacherGroupIdentifiers,
  isOpenPathGroupEnabled,
  isOrgAdmin,
  requireTeacherOrAdmin,
  toOpenPathEnabledFlag,
} from '../../lib/tenant-access.js';

import {
  addGroupToTeacherRole,
  cloneGroupIntoOrganization,
} from '../../services/group-copy.service.js';
import {
  bulkCreateGroupRules,
  createOrReuseGroupRule,
  deleteGroupRule,
  listGroupedGroupRules,
  listGroupRules,
  listPaginatedGroupRules,
  updateGroupRule,
} from '../../services/group-rules.service.js';

type OpenPathWhitelistRule = typeof whitelistRules.$inferSelect;
type OpenPathWhitelistGroup = typeof whitelistGroups.$inferSelect;

type RuleCounts = {
  whitelistCount: number;
  blockedSubdomainCount: number;
  blockedPathCount: number;
};

const EMPTY_RULE_COUNTS: RuleCounts = {
  whitelistCount: 0,
  blockedSubdomainCount: 0,
  blockedPathCount: 0,
};

const GROUP_PERMISSION_OPTS = {
  notAllowedMessage: 'Insufficient permissions for this group',
} as const;

async function removeGroupFromTeacherRole(params: {
  userId: string;
  groupId: string;
}): Promise<void> {
  const existingRoles = await openpathDb
    .select()
    .from(roles)
    .where(eq(roles.userId, params.userId));
  const teacherRole = existingRoles.find((r) => r.role === 'teacher');
  if (!teacherRole || !Array.isArray(teacherRole.groupIds)) return;

  const next = teacherRole.groupIds.filter((gid) => gid !== params.groupId);
  await openpathDb
    .update(roles)
    .set({ groupIds: next as any })
    .where(eq(roles.id, teacherRole.id));
}

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255),
  enabled: z.number().min(0).max(1).default(1),
});

const CloneGroupSchema = z.object({
  sourceGroupId: z.string(),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(255).optional(),
});

const UpdateGroupSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  enabled: z.union([z.number().min(0).max(1), z.boolean()]).optional(),
  visibility: GroupVisibilitySchema.optional(),
});

const AddRuleSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
  value: z.string().min(1).max(500),
  comment: z.string().optional(),
});

// OpenPath SPA uses this schema (type + values array)
const BulkCreateRulesSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
  values: z.array(z.string().min(1).max(500)),
});

const ListRulesPaginatedSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
});

// OpenPath SPA sends { ids: string[] } - just the rule IDs
const BulkDeleteRulesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// Grouped rules pagination - groups by root domain, paginates by groups
const ListRulesGroupedSchema = z.object({
  groupId: z.string(),
  type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  search: z.string().optional(),
});

type AddRuleInput = z.infer<typeof AddRuleSchema>;

function buildRuleCountsByGroupId(
  rules: readonly Pick<OpenPathWhitelistRule, 'groupId' | 'type'>[]
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
  const ids = [...groupIds];

  const allRules = await openpathDb
    .select({ groupId: whitelistRules.groupId, type: whitelistRules.type })
    .from(whitelistRules)
    .where(inArray(whitelistRules.groupId, ids));

  return buildRuleCountsByGroupId(allRules);
}

function serializeGroupForClient(
  group: OpenPathWhitelistGroup,
  params: { visibility?: string; counts?: RuleCounts }
) {
  const counts = params.counts ?? EMPTY_RULE_COUNTS;
  return {
    id: group.id,
    name: group.name,
    displayName: group.displayName,
    enabled: isOpenPathGroupEnabled(group.enabled),
    visibility: params.visibility ?? 'private',
    whitelistCount: counts.whitelistCount,
    blockedSubdomainCount: counts.blockedSubdomainCount,
    blockedPathCount: counts.blockedPathCount,
    createdAt: group.createdAt?.toISOString() ?? null,
    updatedAt: group.updatedAt?.toISOString() ?? null,
  };
}

async function filterGroupsVisibleToUser<T extends { id: string; name: string }>(
  ctx: { userRole?: string; user: { sub: string } },
  groups: readonly T[]
): Promise<T[]> {
  if (isOrgAdmin(ctx)) return [...groups];

  const identifiers = await getTeacherGroupIdentifiers(ctx.user.sub);
  if (identifiers.size === 0) return [];
  return groups.filter((g) => identifiers.has(g.id) || identifiers.has(g.name));
}

async function createWhitelistRuleForGroup(
  ctx: { organizationId?: string; userRole?: string; user: { sub: string } },
  input: AddRuleInput
) {
  await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

  const result = await createOrReuseGroupRule(input);
  if (result.created) {
    await publishWhitelistGroupChanged(input.groupId);
  }

  return result;
}

export const groupsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);
    const orgGroupMetaById = new Map(orgGroups.map((og) => [og.groupId, og]));

    if (groupIds.length === 0) return [];

    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    const visibleGroups = await filterGroupsVisibleToUser(ctx, groups);

    const visibleGroupIds = visibleGroups.map((g) => g.id);

    if (visibleGroupIds.length === 0) return [];

    const ruleCounts = await fetchRuleCountsForGroupIds(visibleGroupIds);

    return visibleGroups.map((g) =>
      serializeGroupForClient(g, {
        visibility: orgGroupMetaById.get(g.id)?.visibility ?? 'private',
        counts: ruleCounts.get(g.id),
      })
    );
  }),

  /**
   * List instance-public groups for browsing/cloning within the organization.
   */
  libraryList: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);

    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.visibility, 'instance_public')
        )
      );

    const groupIds = orgGroups.map((og) => og.groupId);
    const orgGroupMetaById = new Map(orgGroups.map((og) => [og.groupId, og]));

    if (groupIds.length === 0) return [];

    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    if (groups.length === 0) return [];

    const visibleGroupIds = groups.map((g) => g.id);

    const ruleCounts = await fetchRuleCountsForGroupIds(visibleGroupIds);

    return groups.map((g) =>
      serializeGroupForClient(g, {
        visibility: orgGroupMetaById.get(g.id)?.visibility ?? 'private',
        counts: ruleCounts.get(g.id),
      })
    );
  }),

  /**
   * Clone a group into a new private group (copy rules) within the organization.
   */
  clone: tenantProcedure.input(CloneGroupSchema).mutation(async ({ ctx, input }) => {
    await assertCanViewGroup(ctx, input.sourceGroupId, GROUP_PERMISSION_OPTS);

    return cloneGroupIntoOrganization({
      organizationId: ctx.organizationId!,
      actorUserId: ctx.user.sub,
      actorRole: ctx.userRole,
      sourceGroupId: input.sourceGroupId,
      name: input.name,
      displayName: input.displayName,
    });
  }),

  /**
   * Get group statistics for the current organization.
   * Returns counts of groups, whitelist rules, and blocked rules.
   */
  stats: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);
    // Get groups belonging to this organization
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) {
      return { groupCount: 0, whitelistCount: 0, blockedCount: 0 };
    }

    const effectiveGroupIds = isOrgAdmin(ctx)
      ? groupIds
      : await (async () => {
          const identifiers = await getTeacherGroupIdentifiers(ctx.user.sub);
          if (identifiers.size === 0) return [];
          const groups = await openpathDb
            .select({ id: whitelistGroups.id, name: whitelistGroups.name })
            .from(whitelistGroups)
            .where(inArray(whitelistGroups.id, groupIds));
          return groups
            .filter((g) => identifiers.has(g.id) || identifiers.has(g.name))
            .map((g) => g.id);
        })();

    if (effectiveGroupIds.length === 0) {
      return { groupCount: 0, whitelistCount: 0, blockedCount: 0 };
    }

    // Get all rules for these groups
    const rules = await openpathDb
      .select()
      .from(whitelistRules)
      .where(inArray(whitelistRules.groupId, effectiveGroupIds));

    const whitelistCount = rules.filter((r) => r.type === 'whitelist').length;
    const blockedCount = rules.filter(
      (r) => r.type === 'blocked_subdomain' || r.type === 'blocked_path'
    ).length;

    return {
      groupCount: effectiveGroupIds.length,
      whitelistCount,
      blockedCount,
    };
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertCanViewGroup(ctx, input.id, GROUP_PERMISSION_OPTS);

    const group = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, input.id))
      .limit(1);

    if (!group[0]) return null;

    // Serialize Date fields for JSON compatibility
    const g = group[0];
    return {
      id: g.id,
      name: g.name,
      displayName: g.displayName,
      enabled: g.enabled,
      createdAt: g.createdAt?.toISOString() ?? null,
      updatedAt: g.updatedAt?.toISOString() ?? null,
    };
  }),

  getRules: tenantProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

      return listGroupRules({ groupId: input.groupId });
    }),

  getByName: tenantProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const group = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.name, input.name))
      .limit(1);

    if (!group.length) return null;

    const orgGroup = await db
      .select({ id: schema.cpOrganizationGroups.id })
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, group[0].id)
        )
      )
      .limit(1);

    if (!orgGroup.length) return null; // Group exists in OpenPath but not in this org

    if (!isOrgAdmin(ctx)) {
      const identifiers = await getTeacherGroupIdentifiers(ctx.user.sub);
      if (!identifiers.has(group[0].id) && !identifiers.has(group[0].name)) {
        return null;
      }
    }

    // Serialize Date fields for JSON compatibility
    const g = group[0];
    return {
      id: g.id,
      name: g.name,
      displayName: g.displayName,
      enabled: g.enabled,
      createdAt: g.createdAt?.toISOString() ?? null,
      updatedAt: g.updatedAt?.toISOString() ?? null,
    };
  }),

  listRules: tenantProcedure
    .input(
      z.object({
        groupId: z.string(),
        type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

      return listGroupRules(input);
    }),

  // Paginated rules list - OpenPath SPA RulesManager uses this
  listRulesPaginated: tenantProcedure
    .input(ListRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

      return listPaginatedGroupRules(input);
    }),

  // Grouped rules list - groups by root domain, paginates by domain groups
  // Ensures domain groups are never split across pages
  listRulesGrouped: tenantProcedure.input(ListRulesGroupedSchema).query(async ({ ctx, input }) => {
    await assertCanViewGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

    return listGroupedGroupRules(input);
  }),

  // Bulk delete rules - OpenPath SPA RulesManager uses this
  // SPA sends { ids: string[] } and expects { rules: Rule[], deleted: number } for undo
  bulkDeleteRules: tenantProcedure.input(BulkDeleteRulesSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    // Get all rules to be deleted (for undo support)
    const rulesToDelete = await openpathDb
      .select()
      .from(whitelistRules)
      .where(inArray(whitelistRules.id, input.ids));

    if (rulesToDelete.length === 0) {
      return { rules: [], deleted: 0 };
    }

    // Verify all rules belong to groups the user has access to
    const ruleGroupIds = [...new Set(rulesToDelete.map((r) => r.groupId))];
    const orgGroups = await db
      .select({ groupId: schema.cpOrganizationGroups.groupId })
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          inArray(schema.cpOrganizationGroups.groupId, ruleGroupIds)
        )
      );

    const orgGroupIdSet = new Set(orgGroups.map((og) => og.groupId));

    const accessibleRules = isOrgAdmin(ctx)
      ? rulesToDelete.filter((r) => orgGroupIdSet.has(r.groupId))
      : await (async () => {
          const identifiers = await getTeacherGroupIdentifiers(ctx.user.sub);
          if (identifiers.size === 0) return [];
          const groups = await openpathDb
            .select({ id: whitelistGroups.id, name: whitelistGroups.name })
            .from(whitelistGroups)
            .where(inArray(whitelistGroups.id, ruleGroupIds));
          const allowedGroupIds = new Set(
            groups
              .filter(
                (g) => orgGroupIdSet.has(g.id) && (identifiers.has(g.id) || identifiers.has(g.name))
              )
              .map((g) => g.id)
          );
          return rulesToDelete.filter((r) => allowedGroupIds.has(r.groupId));
        })();

    if (accessibleRules.length === 0) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No accessible rules found' });
    }

    const accessibleIds = accessibleRules.map((r) => r.id);

    // Delete the rules
    await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, accessibleIds));

    // Touch affected group versions for agent cache/ETag correctness
    const affectedGroupIds = [...new Set(accessibleRules.map((r) => r.groupId))];
    await publishWhitelistGroupsChanged(affectedGroupIds);

    // Return in format expected by SPA for undo support
    return {
      rules: accessibleRules.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        type: r.type,
        value: r.value,
        comment: r.comment,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
      deleted: accessibleRules.length,
    };
  }),

  create: tenantProcedure.input(CreateGroupSchema).mutation(async ({ ctx, input }) => {
    requireTeacherOrAdmin(ctx);
    const groupId = nanoid();

    let group: OpenPathWhitelistGroup;
    try {
      [group] = await openpathDb
        .insert(whitelistGroups)
        .values({
          id: groupId,
          name: input.name,
          displayName: input.displayName,
          enabled: input.enabled,
        })
        .returning();
    } catch (err: unknown) {
      throwConflictOnUniqueViolation(err, 'Ya existe un grupo con ese identificador (slug)');
    }

    await db.insert(schema.cpOrganizationGroups).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      groupId: group.id,
    });

    if (ctx.userRole === 'teacher') {
      await addGroupToTeacherRole({
        userId: ctx.user.sub,
        groupId: group.id,
        createdBy: ctx.user.sub,
      });
    }

    // Serialize Date fields for JSON compatibility
    return {
      id: group.id,
      name: group.name,
      displayName: group.displayName,
      enabled: isOpenPathGroupEnabled(group.enabled),
      createdAt: group.createdAt?.toISOString() ?? null,
      updatedAt: group.updatedAt?.toISOString() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateGroupSchema).mutation(async ({ ctx, input }) => {
    // Allow updating a disabled group (e.g. to re-enable it).
    // "Use" checks are enforced on rule mutations and assignment flows.
    await assertCanAccessGroup(ctx, input.id, 'edit', GROUP_PERMISSION_OPTS);

    const updateData: {
      updatedAt: Date;
      displayName?: string;
      enabled?: number;
    } = {
      updatedAt: new Date(),
    };

    if (input.displayName !== undefined) {
      updateData.displayName = input.displayName;
    }

    if (input.enabled !== undefined) {
      updateData.enabled = toOpenPathEnabledFlag(input.enabled);
    }

    if (input.visibility !== undefined) {
      await db
        .update(schema.cpOrganizationGroups)
        .set({ visibility: input.visibility })
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.id)
          )
        );
    }

    const [updated] = await openpathDb
      .update(whitelistGroups)
      .set(updateData)
      .where(eq(whitelistGroups.id, input.id))
      .returning();

    await notifyOpenPathGroupChanged(updated.id);

    // Serialize Date fields for JSON compatibility
    return {
      id: updated.id,
      name: updated.name,
      displayName: updated.displayName,
      enabled: isOpenPathGroupEnabled(updated.enabled),
      createdAt: updated.createdAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt?.toISOString() ?? null,
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await assertCanUseGroup(ctx, input.id, GROUP_PERMISSION_OPTS);

    await db
      .delete(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.id)
        )
      );

    const stillReferenced = await db
      .select({ id: schema.cpOrganizationGroups.id })
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.groupId, input.id))
      .limit(1);

    // Safety: if another organization still references the same OpenPath group,
    // do not delete the underlying whitelist group row.
    if (stillReferenced.length > 0) {
      return { success: true };
    }

    await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, input.id));

    if (ctx.userRole === 'teacher') {
      await removeGroupFromTeacherRole({ userId: ctx.user.sub, groupId: input.id });
    }

    await notifyOpenPathGroupChanged(input.id);

    return { success: true };
  }),

  addRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return createWhitelistRuleForGroup(ctx, input);
  }),

  // Alias for addRule - OpenPath SPA calls this
  createRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    return createWhitelistRuleForGroup(ctx, input);
  }),

  // Bulk create rules - OpenPath SPA calls this for batch operations
  bulkCreateRules: tenantProcedure.input(BulkCreateRulesSchema).mutation(async ({ ctx, input }) => {
    await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

    const insertedCount = await bulkCreateGroupRules(input);

    if (insertedCount > 0) {
      await publishWhitelistGroupChanged(input.groupId);
    }

    // Return count like OpenPath does
    return { count: insertedCount };
  }),

  deleteRule: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

      const deleted = await deleteGroupRule(input);

      if (deleted) {
        await publishWhitelistGroupChanged(input.groupId);
      }

      return { success: true };
    }),

  updateRule: tenantProcedure
    .input(
      z.object({
        id: z.string().min(1),
        groupId: z.string().min(1),
        value: z.string().min(1).max(500).optional(),
        comment: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanUseGroup(ctx, input.groupId, GROUP_PERMISSION_OPTS);

      const { rule, valueChanged } = await updateGroupRule(input);

      if (valueChanged) {
        await publishWhitelistGroupChanged(input.groupId);
      }

      return rule;
    }),

  /**
   * Get system status (enabled/disabled groups count) for the current organization.
   * Used by Dashboard to show system status overview.
   */
  systemStatus: tenantProcedure.query(async ({ ctx }) => {
    requireTeacherOrAdmin(ctx);
    // Get groups belonging to this organization
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) {
      return {
        // OpenPath-compatible shape
        enabled: false,
        totalGroups: 0,
        activeGroups: 0,
        pausedGroups: 0,

        // ClassroomPath integration tests expect these
        enabledGroups: 0,
        disabledGroups: 0,
      };
    }

    // Get all groups and count enabled/disabled
    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    const visibleGroups = await filterGroupsVisibleToUser(ctx, groups);

    if (visibleGroups.length === 0) {
      return {
        enabled: false,
        totalGroups: 0,
        activeGroups: 0,
        pausedGroups: 0,
        enabledGroups: 0,
        disabledGroups: 0,
      };
    }

    const enabledGroups = visibleGroups.filter((g) => isOpenPathGroupEnabled(g.enabled)).length;
    const disabledGroups = visibleGroups.length - enabledGroups;

    return {
      // OpenPath-compatible shape
      enabled: enabledGroups > 0,
      totalGroups: visibleGroups.length,
      activeGroups: enabledGroups,
      pausedGroups: disabledGroups,

      // ClassroomPath integration tests expect these
      enabledGroups,
      disabledGroups,
    };
  }),
});
