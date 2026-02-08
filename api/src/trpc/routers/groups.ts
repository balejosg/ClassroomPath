// @ts-nocheck
import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, whitelistGroups, whitelistRules } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';

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

const BulkCreateRulesSchema = z.object({
  groupId: z.string(),
  rules: z.array(
    z.object({
      type: z.enum(['whitelist', 'blocked_subdomain', 'blocked_path']),
      value: z.string().min(1).max(500),
      comment: z.string().optional(),
    })
  ),
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

    // Check for existing rule with same groupId, type, and value (prevent duplicates)
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
      // Return existing rule instead of creating duplicate
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

    const [rule] = await openpathDb
      .insert(whitelistRules)
      .values({
        id: nanoid(),
        groupId: input.groupId,
        type: input.type,
        value: input.value,
        comment: input.comment,
      })
      .returning();

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

    // Check for existing rule with same groupId, type, and value (prevent duplicates)
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
      // Return existing rule instead of creating duplicate
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

    const [rule] = await openpathDb
      .insert(whitelistRules)
      .values({
        id: nanoid(),
        groupId: input.groupId,
        type: input.type,
        value: input.value,
        comment: input.comment,
      })
      .returning();

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

    const rulesToInsert = input.rules.map((rule) => ({
      id: nanoid(),
      groupId: input.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
    }));

    const insertedRules = await openpathDb.insert(whitelistRules).values(rulesToInsert).returning();

    return insertedRules.map((rule) => ({
      id: rule.id,
      groupId: rule.groupId,
      type: rule.type,
      value: rule.value,
      comment: rule.comment,
      createdAt: rule.createdAt?.toISOString() ?? null,
    }));
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
