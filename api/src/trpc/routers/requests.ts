import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { openpathDb, requests, whitelistRules } from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and, sql } from 'drizzle-orm';

function isAdminUser(ctx: {
  user: { roles?: Array<{ role: string; groupIds?: string[] | null }> };
}) {
  return (ctx.user.roles ?? []).some((r) => r.role === 'admin');
}

function canTeacherManageGroup(
  ctx: { user: { roles?: Array<{ role: string; groupIds?: string[] | null }> } },
  groupId: string
) {
  return (ctx.user.roles ?? []).some(
    (r) => r.role === 'teacher' && Array.isArray(r.groupIds) && r.groupIds.includes(groupId)
  );
}

async function groupBelongsToOrganization(
  organizationId: string,
  groupId: string
): Promise<boolean> {
  const orgGroup = await db
    .select()
    .from(schema.cpOrganizationGroups)
    .where(
      and(
        eq(schema.cpOrganizationGroups.organizationId, organizationId),
        eq(schema.cpOrganizationGroups.groupId, groupId)
      )
    )
    .limit(1);

  return orgGroup.length > 0;
}

export const requestsRouter = router({
  create: tenantProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        groupId: z.string().optional(),
        reason: z.string().optional(),
        requesterEmail: z.string().email().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.groupId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'groupId is required for tenant requests',
        });
      }

      const inTenant = await groupBelongsToOrganization(ctx.organizationId!, input.groupId);
      if (!inTenant) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Group does not belong to tenant',
        });
      }

      const pendingRequest = await openpathDb
        .select({ id: requests.id })
        .from(requests)
        .where(
          and(
            sql`LOWER(${requests.domain}) = LOWER(${input.domain})`,
            eq(requests.status, 'pending')
          )
        )
        .limit(1);

      if (pendingRequest.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Pending request exists for this domain',
        });
      }

      const [created] = await openpathDb
        .insert(requests)
        .values({
          id: `req_${nanoid(8)}`,
          domain: input.domain.toLowerCase(),
          reason: input.reason ?? 'No reason provided',
          requesterEmail: input.requesterEmail ?? ctx.user.email ?? 'anonymous@tenant.local',
          groupId: input.groupId,
          priority: input.priority ?? 'normal',
          status: 'pending',
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create request',
        });
      }

      return {
        ...created,
        createdAt: created.createdAt?.toISOString() ?? null,
        updatedAt: created.updatedAt?.toISOString() ?? null,
      };
    }),

  // List groups for the organization (used by DomainRequests dropdown)
  listGroups: tenantProcedure.query(async ({ ctx }) => {
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) return [];

    // Import whitelistGroups from openpath db
    const { whitelistGroups } = await import('../../db/openpath.js');
    const groups = await openpathDb
      .select()
      .from(whitelistGroups)
      .where(inArray(whitelistGroups.id, groupIds));

    // Return shape expected by DomainRequests UI: { name, path }
    // path = group.id (the stable identifier for approve mutations)
    return groups.map((g) => ({
      name: g.displayName ?? g.name,
      path: g.id,
    }));
  }),

  /**
   * Get request statistics for the current organization.
   * Returns counts by status: total, pending, approved, rejected.
   */
  stats: tenantProcedure.query(async ({ ctx }) => {
    // Get groups belonging to this organization
    const orgGroups = await db
      .select()
      .from(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

    const groupIds = orgGroups.map((og) => og.groupId);

    if (groupIds.length === 0) {
      return { total: 0, pending: 0, approved: 0, rejected: 0 };
    }

    // Get all requests for these groups
    const allRequests = await openpathDb
      .select()
      .from(requests)
      .where(inArray(requests.groupId, groupIds));

    return {
      total: allRequests.length,
      pending: allRequests.filter((r) => r.status === 'pending').length,
      approved: allRequests.filter((r) => r.status === 'approved').length,
      rejected: allRequests.filter((r) => r.status === 'rejected').length,
    };
  }),

  list: tenantProcedure
    .input(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))
    .query(async ({ ctx, input }) => {
      // Get all groups for this organization
      const orgGroups = await db
        .select()
        .from(schema.cpOrganizationGroups)
        .where(eq(schema.cpOrganizationGroups.organizationId, ctx.organizationId!));

      const groupIds = orgGroups.map((og) => og.groupId);

      if (groupIds.length === 0) return [];

      // Filter requests that belong to one of the organization's groups
      const conditions = [inArray(requests.groupId, groupIds)];
      if (input.status) {
        conditions.push(eq(requests.status, input.status));
      }

      const results = await openpathDb
        .select()
        .from(requests)
        .where(and(...conditions))
        .orderBy(requests.createdAt);

      // Serialize Date fields for JSON compatibility
      return results.map((r) => ({
        ...r,
        createdAt: r.createdAt?.toISOString() ?? null,
        updatedAt: r.updatedAt?.toISOString() ?? null,
      }));
    }),

  approve: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const request = await openpathDb
      .select()
      .from(requests)
      .where(eq(requests.id, input.id))
      .limit(1);

    if (!request[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    }
    if (!request[0].groupId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request has no group assigned' });
    }
    if (request[0].status !== 'pending') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
    }

    const requestGroupId = request[0].groupId;
    const inTenant = await groupBelongsToOrganization(ctx.organizationId!, requestGroupId);
    if (!inTenant) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Request does not belong to tenant' });
    }

    const allowed = isAdminUser(ctx) || canTeacherManageGroup(ctx, requestGroupId);
    if (!allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions for this group',
      });
    }

    await openpathDb
      .insert(whitelistRules)
      .values({
        id: `rule-${nanoid(16)}`,
        groupId: requestGroupId,
        type: 'whitelist',
        value: request[0].domain,
      })
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      });

    await openpathDb
      .update(requests)
      .set({
        status: 'approved',
        updatedAt: new Date(),
        resolvedAt: new Date(),
        resolvedBy: ctx.user.name,
        resolutionNote: 'Approved from tenant gateway',
      })
      .where(eq(requests.id, input.id));

    return { success: true };
  }),

  reject: tenantProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const request = await openpathDb
        .select()
        .from(requests)
        .where(eq(requests.id, input.id))
        .limit(1);

      if (!request[0] || !request[0].groupId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      }
      if (request[0].status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
      }

      const inTenant = await groupBelongsToOrganization(ctx.organizationId!, request[0].groupId);
      if (!inTenant) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Request does not belong to tenant' });
      }

      const allowed = isAdminUser(ctx) || canTeacherManageGroup(ctx, request[0].groupId);
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Insufficient permissions for this group',
        });
      }

      await openpathDb
        .update(requests)
        .set({
          status: 'rejected',
          updatedAt: new Date(),
          resolvedAt: new Date(),
          resolvedBy: ctx.user.name,
          resolutionNote: input.reason ?? null,
        })
        .where(eq(requests.id, input.id));

      return { success: true };
    }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    if (!isAdminUser(ctx)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
    }

    const request = await openpathDb
      .select()
      .from(requests)
      .where(eq(requests.id, input.id))
      .limit(1);

    if (!request[0] || !request[0].groupId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    }

    const inTenant = await groupBelongsToOrganization(ctx.organizationId!, request[0].groupId);
    if (!inTenant) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Request does not belong to tenant' });
    }

    await openpathDb.delete(requests).where(eq(requests.id, input.id));

    return { success: true };
  }),
});
