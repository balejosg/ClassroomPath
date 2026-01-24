// @ts-nocheck
import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { openpathDb, requests } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and } from 'drizzle-orm';

export const requestsRouter = router({
    list: tenantProcedure
        .input(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))
        .query(async ({ ctx, input }) => {
            // Get all groups for this organization
            const orgGroups = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

            const groupIds = orgGroups.map(og => og.groupId);

            if (groupIds.length === 0) return [];

            // Filter requests that belong to one of the organization's groups
            const conditions = [inArray(requests.groupId, groupIds)];
            if (input.status) {
                conditions.push(eq(requests.status, input.status));
            }

            const results = await openpathDb.select()
                .from(requests)
                .where(and(...conditions))
                .orderBy(requests.createdAt);

            // Serialize Date fields for JSON compatibility
            return results.map(r => ({
                ...r,
                createdAt: r.createdAt?.toISOString() ?? null,
                updatedAt: r.updatedAt?.toISOString() ?? null,
            }));
        }),

    approve: tenantProcedure
        .input(z.object({ id: z.string(), groupId: z.string().optional() }))
        .mutation(async ({ ctx, input }) => {
            // Verify request belongs to org (via groupId)
            const request = await openpathDb.select()
                .from(requests)
                .where(eq(requests.id, input.id))
                .limit(1);

            if (!request[0]) throw new Error('Request not found');
            
            const targetGroupId = input.groupId || request[0].groupId;
            if (!targetGroupId) throw new Error('Target group required');

            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, targetGroupId)
                ))
                .limit(1);

            if (!orgGroup.length) throw new Error('Access denied to target group');

            // Logic for actually adding the rule should be handled by OpenPath API
            // but for simplicity in multi-tenant, we can just update status
            // and the user should manually add the rule OR we call RequestService if available.
            // In ClassroomPath, we usually proxy complex mutations or implement them here.
            
            // For now, let's just update the status to match what the UI expects
            await openpathDb.update(requests)
                .set({ status: 'approved', updatedAt: new Date() } as any)
                .where(eq(requests.id, input.id));

            return { success: true };
        }),

    reject: tenantProcedure
        .input(z.object({ id: z.string(), reason: z.string().optional() }))
        .mutation(async ({ ctx, input }) => {
            const request = await openpathDb.select()
                .from(requests)
                .where(eq(requests.id, input.id))
                .limit(1);

            if (!request[0] || !request[0].groupId) throw new Error('Request not found');

            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, request[0].groupId)
                ))
                .limit(1);

            if (!orgGroup.length) throw new Error('Access denied');

            await openpathDb.update(requests)
                .set({ status: 'rejected', reason: input.reason, updatedAt: new Date() } as any)
                .where(eq(requests.id, input.id));

            return { success: true };
        }),

    delete: tenantProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const request = await openpathDb.select()
                .from(requests)
                .where(eq(requests.id, input.id))
                .limit(1);

            if (!request[0] || !request[0].groupId) throw new Error('Request not found');

            const orgGroup = await db.select()
                .from(schema.cpOrganizationGroups)
                .where(and(
                    eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!),
                    eq(schema.cpOrganizationGroups.groupId, request[0].groupId)
                ))
                .limit(1);

            if (!orgGroup.length) throw new Error('Access denied');

            await openpathDb.delete(requests)
                .where(eq(requests.id, input.id));

            return { success: true };
        }),
});
