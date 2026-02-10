// @ts-nocheck
import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getRootDomain } from '../../utils/domain.js';

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255),
  enabled: z.number().min(0).max(1).default(1),
});

const UpdateGroupSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(255).optional(),
  enabled: z.number().min(0).max(1).optional(),
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

export const groupsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) return [];

    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    // Get all rules for these groups to calculate counts
    const allRules = await openpathDb
      .select()
      .from(whitelistRules)
      .where(inArray(whitelistRules.groupId, groupIds));

    // Build a map of groupId -> rule counts
    const ruleCounts = new Map<
      string,
      { whitelistCount: number; blockedSubdomainCount: number; blockedPathCount: number }
    >();
    for (const groupId of groupIds) {
      const groupRules = allRules.filter((r) => r.groupId === groupId);
      ruleCounts.set(groupId, {
        whitelistCount: groupRules.filter((r) => r.type === 'whitelist').length,
        blockedSubdomainCount: groupRules.filter((r) => r.type === 'blocked_subdomain').length,
        blockedPathCount: groupRules.filter((r) => r.type === 'blocked_path').length,
      });
    }

    // Serialize Date fields for JSON compatibility and include rule counts
    return groups.map((g) => {
      const counts = ruleCounts.get(g.id) || {
        whitelistCount: 0,
        blockedSubdomainCount: 0,
        blockedPathCount: 0,
      };
      return {
        id: g.id,
        name: g.name,
        displayName: g.displayName,
        enabled: g.enabled,
        whitelistCount: counts.whitelistCount,
        blockedSubdomainCount: counts.blockedSubdomainCount,
        blockedPathCount: counts.blockedPathCount,
        createdAt: g.createdAt?.toISOString() ?? null,
        updatedAt: g.updatedAt?.toISOString() ?? null,
      };
    });
  }),

  /**
   * Get group statistics for the current organization.
   * Returns counts of groups, whitelist rules, and blocked rules.
   */
  stats: tenantProcedure.query(async ({ ctx }) => {
    // Get groups belonging to this organization
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) {
      return { groupCount: 0, whitelistCount: 0, blockedCount: 0 };
    }

    // Get all rules for these groups
    const rules = await openpathDb
      .select()
      .from(whitelistRules)
      .where(inArray(whitelistRules.groupId, groupIds));

    const whitelistCount = rules.filter((r) => r.type === 'whitelist').length;
    const blockedCount = rules.filter(
      (r) => r.type === 'blocked_subdomain' || r.type === 'blocked_path'
    ).length;

    return {
      groupCount: groupIds.length,
      whitelistCount,
      blockedCount,
    };
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.id)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

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
      const orgGroup = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.groupId)
          )
        )
        .limit(1);

      if (!orgGroup.length) {
        throw new Error('Group not found or access denied');
      }

      const rules = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.groupId, input.groupId));

      // Serialize Date fields for JSON compatibility
      return rules.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        type: r.type,
        value: r.value,
        comment: r.comment,
        createdAt: r.createdAt?.toISOString() ?? null,
      }));
    }),

  getByName: tenantProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    const group = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(eq(whitelistGroups.name, input.name))
      .limit(1);

    if (!group.length) return null;

    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, group[0].id)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      return null; // Group exists in OpenPath but not in this org
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
      const orgGroup = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.groupId)
          )
        )
        .limit(1);

      if (!orgGroup.length) {
        throw new Error('Group not found or access denied');
      }

      // Build query with optional type filter
      const whereConditions = input.type
        ? and(eq(whitelistRules.groupId, input.groupId), eq(whitelistRules.type, input.type))
        : eq(whitelistRules.groupId, input.groupId);

      const rules = await openpathDb.select().from(whitelistRules).where(whereConditions);

      // Serialize Date fields for JSON compatibility
      return rules.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        type: r.type,
        value: r.value,
        comment: r.comment,
        createdAt: r.createdAt?.toISOString() ?? null,
      }));
    }),

  // Paginated rules list - OpenPath SPA RulesManager uses this
  listRulesPaginated: tenantProcedure
    .input(ListRulesPaginatedSchema)
    .query(async ({ ctx, input }) => {
      const orgGroup = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.groupId)
          )
        )
        .limit(1);

      if (!orgGroup.length) {
        throw new Error('Group not found or access denied');
      }

      // Build base query conditions
      const conditions: ReturnType<typeof eq>[] = [eq(whitelistRules.groupId, input.groupId)];

      if (input.type) {
        conditions.push(eq(whitelistRules.type, input.type));
      }

      // Get total count first
      const allRules = await openpathDb
        .select()
        .from(whitelistRules)
        .where(and(...conditions));

      // Filter by search if provided
      let filteredRules = allRules;
      if (input.search) {
        const searchLower = input.search.toLowerCase();
        filteredRules = allRules.filter(
          (r) =>
            r.value.toLowerCase().includes(searchLower) ||
            (r.comment && r.comment.toLowerCase().includes(searchLower))
        );
      }

      const total = filteredRules.length;

      // Apply pagination
      const paginatedRules = filteredRules.slice(input.offset, input.offset + input.limit);

      return {
        rules: paginatedRules.map((r) => ({
          id: r.id,
          groupId: r.groupId,
          type: r.type,
          value: r.value,
          comment: r.comment,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  // Grouped rules list - groups by root domain, paginates by domain groups
  // Ensures domain groups are never split across pages
  listRulesGrouped: tenantProcedure.input(ListRulesGroupedSchema).query(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.groupId)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    // Build base query conditions
    const conditions = [eq(whitelistRules.groupId, input.groupId)];

    if (input.type) {
      conditions.push(eq(whitelistRules.type, input.type));
    }

    // Get all rules for the group
    const allRules = await openpathDb
      .select()
      .from(whitelistRules)
      .where(and(...conditions));

    // Apply search filter if provided
    let filtered = allRules;
    if (input.search?.trim()) {
      const searchLower = input.search.toLowerCase().trim();
      filtered = allRules.filter((r) => r.value.toLowerCase().includes(searchLower));
    }

    // Group rules by root domain
    const groupedMap = new Map();
    for (const rule of filtered) {
      const root = getRootDomain(rule.value);
      const existing = groupedMap.get(root) ?? [];
      existing.push(rule);
      groupedMap.set(root, existing);
    }

    // Sort root domains alphabetically
    const sortedRoots = Array.from(groupedMap.keys()).sort((a, b) => a.localeCompare(b));

    // Calculate totals before pagination
    const totalGroups = sortedRoots.length;
    const totalRules = filtered.length;

    // Apply pagination on groups (not individual rules)
    const paginatedRoots = sortedRoots.slice(input.offset, input.offset + input.limit);

    // Build domain groups with status
    const groups = paginatedRoots.map((root) => {
      const groupRules = groupedMap.get(root) ?? [];
      // Sort rules within group alphabetically
      groupRules.sort((a, b) => a.value.localeCompare(b.value));

      // Determine status based on rule types
      const hasWhitelist = groupRules.some((r) => r.type === 'whitelist');
      const hasBlocked = groupRules.some(
        (r) => r.type === 'blocked_subdomain' || r.type === 'blocked_path'
      );

      let status;
      if (hasWhitelist && hasBlocked) {
        status = 'mixed';
      } else if (hasBlocked) {
        status = 'blocked';
      } else {
        status = 'allowed';
      }

      return {
        root,
        rules: groupRules.map((r) => ({
          id: r.id,
          groupId: r.groupId,
          type: r.type,
          value: r.value,
          comment: r.comment,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
        status,
      };
    });

    return {
      groups,
      totalGroups,
      totalRules,
      hasMore: input.offset + input.limit < totalGroups,
    };
  }),

  // Bulk delete rules - OpenPath SPA RulesManager uses this
  // SPA sends { ids: string[] } and expects { rules: Rule[], deleted: number } for undo
  bulkDeleteRules: tenantProcedure.input(BulkDeleteRulesSchema).mutation(async ({ ctx, input }) => {
    // Get all rules to be deleted (for undo support)
    const rulesToDelete = await openpathDb
      .select()
      .from(whitelistRules)
      .where(inArray(whitelistRules.id, input.ids));

    if (rulesToDelete.length === 0) {
      return { rules: [], deleted: 0 };
    }

    // Verify all rules belong to groups the user has access to
    const groupIds = [...new Set(rulesToDelete.map((r) => r.groupId))];
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          inArray(schema.cpOrganizationGroups.groupId, groupIds)
        )
      );

    const accessibleGroupIds = new Set(orgGroups.map((og) => og.groupId));
    const accessibleRules = rulesToDelete.filter((r) => accessibleGroupIds.has(r.groupId));

    if (accessibleRules.length === 0) {
      throw new Error('No accessible rules found');
    }

    const accessibleIds = accessibleRules.map((r) => r.id);

    // Delete the rules
    await openpathDb.delete(whitelistRules).where(inArray(whitelistRules.id, accessibleIds));

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
    const groupId = nanoid();

    const [group] = await openpathDb
      .insert(whitelistGroups)
      .values({
        id: groupId,
        name: input.name,
        displayName: input.displayName,
        enabled: input.enabled as any,
      })
      .returning();

    await db.insert(schema.cpOrganizationGroups).values({
      id: nanoid(),
      organizationId: ctx.organizationId!,
      groupId: group.id,
    });

    // Serialize Date fields for JSON compatibility
    return {
      id: group.id,
      name: group.name,
      displayName: group.displayName,
      enabled: group.enabled,
      createdAt: group.createdAt?.toISOString() ?? null,
      updatedAt: group.updatedAt?.toISOString() ?? null,
    };
  }),

  update: tenantProcedure.input(UpdateGroupSchema).mutation(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.id)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    const { id, ...updateData } = input;
    const [updated] = await openpathDb
      .update(whitelistGroups)
      .set(updateData)
      .where(eq(whitelistGroups.id, id))
      .returning();

    // Serialize Date fields for JSON compatibility
    return {
      id: updated.id,
      name: updated.name,
      displayName: updated.displayName,
      enabled: updated.enabled,
      createdAt: updated.createdAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt?.toISOString() ?? null,
    };
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.id)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.id, orgGroup[0].id));

    await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, input.id));

    return { success: true };
  }),

  addRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.groupId)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    // Use atomic upsert with ON CONFLICT DO NOTHING to prevent race conditions
    // The database has a unique constraint on (groupId, type, value)
    const newId = nanoid();
    const insertResult = await openpathDb
      .insert(whitelistRules)
      .values({
        id: newId,
        groupId: input.groupId,
        type: input.type,
        value: input.value,
        comment: input.comment,
      })
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      })
      .returning();

    // If insert was skipped due to conflict, fetch the existing rule
    if (insertResult.length === 0) {
      const existingRule = await openpathDb
        .select()
        .from(whitelistRules)
        .where(
          and(
            eq(whitelistRules.groupId, input.groupId),
            eq(whitelistRules.type, input.type),
            eq(whitelistRules.value, input.value)
          )
        )
        .limit(1);

      if (existingRule.length > 0) {
        const existing = existingRule[0];
        return {
          id: existing.id,
          groupId: existing.groupId,
          type: existing.type,
          value: existing.value,
          comment: existing.comment,
          createdAt: existing.createdAt?.toISOString() ?? null,
        };
      }
      throw new Error('Failed to create or find rule');
    }

    const rule = insertResult[0];
    // Serialize Date fields for JSON compatibility
    return {
      id: rule.id,
      groupId: rule.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
      createdAt: rule.createdAt?.toISOString() ?? null,
    };
  }),

  // Alias for addRule - OpenPath SPA calls this
  createRule: tenantProcedure.input(AddRuleSchema).mutation(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.groupId)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    // Use atomic upsert with ON CONFLICT DO NOTHING to prevent race conditions
    // The database has a unique constraint on (groupId, type, value)
    const newId = nanoid();
    const insertResult = await openpathDb
      .insert(whitelistRules)
      .values({
        id: newId,
        groupId: input.groupId,
        type: input.type,
        value: input.value,
        comment: input.comment,
      })
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      })
      .returning();

    // If insert was skipped due to conflict, fetch the existing rule
    if (insertResult.length === 0) {
      const existingRule = await openpathDb
        .select()
        .from(whitelistRules)
        .where(
          and(
            eq(whitelistRules.groupId, input.groupId),
            eq(whitelistRules.type, input.type),
            eq(whitelistRules.value, input.value)
          )
        )
        .limit(1);

      if (existingRule.length > 0) {
        const existing = existingRule[0];
        return {
          id: existing.id,
          groupId: existing.groupId,
          type: existing.type,
          value: existing.value,
          comment: existing.comment,
          createdAt: existing.createdAt?.toISOString() ?? null,
        };
      }
      // This shouldn't happen, but handle gracefully
      throw new Error('Failed to create or find rule');
    }

    const rule = insertResult[0];
    return {
      id: rule.id,
      groupId: rule.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
      createdAt: rule.createdAt?.toISOString() ?? null,
    };
  }),

  // Bulk create rules - OpenPath SPA calls this for batch operations
  bulkCreateRules: tenantProcedure.input(BulkCreateRulesSchema).mutation(async ({ ctx, input }) => {
    const orgGroup = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(
        and(
          eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
          eq(schema.cpOrganizationGroups.groupId, input.groupId)
        )
      )
      .limit(1);

    if (!orgGroup.length) {
      throw new Error('Group not found or access denied');
    }

    // Convert values array to rules format
    const rulesToInsert = input.values.map((value) => ({
      id: nanoid(),
      groupId: input.groupId,
      type: input.type,
      value: value,
    }));

    // Use onConflictDoNothing to skip duplicates
    const insertedRules = await openpathDb
      .insert(whitelistRules)
      .values(rulesToInsert)
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      })
      .returning();

    // Return count like OpenPath does
    return { count: insertedRules.length };
  }),

  deleteRule: tenantProcedure
    .input(z.object({ id: z.string(), groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgGroup = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.groupId)
          )
        )
        .limit(1);

      if (!orgGroup.length) {
        throw new Error('Group not found or access denied');
      }

      await openpathDb.delete(whitelistRules).where(eq(whitelistRules.id, input.id));

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
      // Verify tenant authorization
      const orgGroup = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(
          and(
            eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
            eq(schema.cpOrganizationGroups.groupId, input.groupId)
          )
        )
        .limit(1);

      if (!orgGroup.length) {
        throw new Error('Group not found or access denied');
      }

      // Get existing rule
      const [existing] = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.id, input.id));

      if (!existing) {
        throw new Error('Rule not found');
      }

      // Build update object
      const updates: Partial<{ value: string; comment: string | null }> = {};

      if (input.value !== undefined) {
        const normalizedValue = input.value.toLowerCase().trim();

        // Check for duplicates if changing value
        const [duplicate] = await openpathDb
          .select()
          .from(whitelistRules)
          .where(
            and(
              eq(whitelistRules.groupId, existing.groupId),
              eq(whitelistRules.type, existing.type),
              eq(whitelistRules.value, normalizedValue)
            )
          );

        if (duplicate && duplicate.id !== input.id) {
          throw new Error('A rule with this value already exists');
        }

        updates.value = normalizedValue;
      }

      if (input.comment !== undefined) {
        updates.comment = input.comment;
      }

      // Only update if there's something to update
      if (Object.keys(updates).length > 0) {
        await openpathDb.update(whitelistRules).set(updates).where(eq(whitelistRules.id, input.id));
      }

      // Return updated rule
      const [updated] = await openpathDb
        .select()
        .from(whitelistRules)
        .where(eq(whitelistRules.id, input.id));

      return {
        id: updated.id,
        groupId: updated.groupId,
        type: updated.type,
        value: updated.value,
        comment: updated.comment,
        createdAt: updated.createdAt?.toISOString() ?? null,
      };
    }),

  /**
   * Get system status (enabled/disabled groups count) for the current organization.
   * Used by Dashboard to show system status overview.
   */
  systemStatus: tenantProcedure.query(async ({ ctx }) => {
    // Get groups belonging to this organization
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) {
      return { enabledGroups: 0, disabledGroups: 0, totalGroups: 0 };
    }

    // Get all groups and count enabled/disabled
    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    const enabledGroups = groups.filter((g) => g.enabled === 1).length;
    const disabledGroups = groups.filter((g) => g.enabled === 0).length;

    return {
      enabledGroups,
      disabledGroups,
      totalGroups: groups.length,
    };
  }),
});
