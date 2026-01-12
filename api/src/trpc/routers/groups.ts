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

export const groupsRouter = router({
    list: tenantProcedure.query(async ({ ctx }) => {
        const orgGroups = await db.select()
            .from(schema.cpOrganizationGroups)
            .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

        const groupIds = orgGroups.map(og => og.groupId);

        if (groupIds.length === 0) return [];

        const groups = await openpathDb.select()
            .from(whitelistGroups)
            .where(inArray(whitelistGroups.id, groupIds));

        return groups;
    }),

    getById: tenantProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.id)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            const group = await openpathDb.select()
                .from(whitelistGroups)
                .where(eq(whitelistGroups.id, input.id))
                .limit(1);

            return group[0] || null;
        }),

    getRules: tenantProcedure
        .input(z.object({ groupId: z.string() }))
        .query(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.groupId)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            const rules = await openpathDb.select()
                .from(whitelistRules)
                .where(eq(whitelistRules.groupId, input.groupId));

            return rules;
        }),

    create: tenantProcedure
        .input(CreateGroupSchema)
        .mutation(async ({ ctx, input }) => {
            const groupId = nanoid();

            const [group] = await openpathDb.insert(whitelistGroups)
                .values({
                    id: groupId,
                    name: input.name,
                    displayName: input.displayName,
                    enabled: input.enabled,
                })
                .returning();

            await db.insert(schema.cpOrganizationGroups)
                .values({
                    id: nanoid(),
                    organizationId: ctx.organizationId!,
                    groupId: group.id,
                });

            return group;
        }),

    update: tenantProcedure
        .input(UpdateGroupSchema)
        .mutation(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.id)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            const { id, ...updateData } = input;
            const [updated] = await openpathDb.update(whitelistGroups)
                .set(updateData)
                .where(eq(whitelistGroups.id, id))
                .returning();

            return updated;
        }),

    delete: tenantProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.id)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            await db.delete(schema.cpOrganizationGroups)
                .where(eq(schema.cpOrganizationGroups.id, orgGroup[0].id));

            await openpathDb.delete(whitelistGroups)
                .where(eq(whitelistGroups.id, input.id));

            return { success: true };
        }),

    addRule: tenantProcedure
        .input(AddRuleSchema)
        .mutation(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.groupId)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            const [rule] = await openpathDb.insert(whitelistRules)
                .values({
                    id: nanoid(),
                    groupId: input.groupId,
                    type: input.type,
                    value: input.value,
                    comment: input.comment,
                })
                .returning();

            return rule;
        }),

    deleteRule: tenantProcedure
        .input(z.object({ ruleId: z.string(), groupId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, input.groupId)
                ))
                .limit(1);

            if (!orgGroup.length) {
                throw new Error('Group not found or access denied');
            }

            await openpathDb.delete(whitelistRules)
                .where(eq(whitelistRules.id, input.ruleId));

            return { success: true };
        }),
});
