import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import {
  openpathDb,
  publishWhitelistGroupChanged,
  requests,
  whitelistGroups,
  whitelistRules,
} from '../../db/openpath.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { eq, inArray, and, sql } from 'drizzle-orm';

import {
  assertCanUseGroup,
  getAccessibleTenantGroupIds,
  isOrgAdmin,
} from '../../lib/tenant-access.js';

type TenantUserRole = { role: string; groupIds?: string[] | null };

type TenantRouterContext = {
  organizationId: string;
  userRole?: string;
  user: {
    sub: string;
    name?: string | null;
    email?: string | null;
    roles?: TenantUserRole[];
  };
};

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

async function assertGroupBelongsToTenant(
  ctx: TenantRouterContext,
  groupId: string
): Promise<void> {
  const inTenant = await groupBelongsToOrganization(ctx.organizationId, groupId);
  if (!inTenant) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Group does not belong to tenant',
    });
  }
}

async function assertCanManageGroup(ctx: TenantRouterContext, groupId: string): Promise<void> {
  await assertCanUseGroup(ctx, groupId, {
    notTeacherMessage: 'Insufficient permissions for this group',
    notAllowedMessage: 'Insufficient permissions for this group',
  });
}

async function getRequestById(requestId: string) {
  const request = await openpathDb
    .select()
    .from(requests)
    .where(eq(requests.id, requestId))
    .limit(1);

  if (!request[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
  }

  return request[0];
}

function assertRequestHasGroupId(request: { groupId: string | null }): string {
  if (!request.groupId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request has no group assigned' });
  }
  return request.groupId;
}

function assertPendingRequest(request: { status: string }): void {
  if (request.status !== 'pending') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
  }
}

async function assertRequestBelongsToTenant(
  ctx: TenantRouterContext,
  requestGroupId: string
): Promise<void> {
  const inTenant = await groupBelongsToOrganization(ctx.organizationId, requestGroupId);
  if (!inTenant) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Request does not belong to tenant' });
  }
}

function serializeRequestDates<T extends { createdAt: Date | null; updatedAt: Date | null }>(
  request: T
) {
  return {
    ...request,
    createdAt: request.createdAt?.toISOString() ?? null,
    updatedAt: request.updatedAt?.toISOString() ?? null,
  };
}

function requireTenantOrganizationId(organizationId: string | null | undefined): string {
  if (!organizationId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing tenant context' });
  }
  return organizationId;
}

export const requestsRouter = router({
  create: tenantProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        groupId: z.string().optional(),
        reason: z.string().optional(),
        requesterEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.groupId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'groupId is required for tenant requests',
        });
      }

      const tenantContext: TenantRouterContext = {
        organizationId: requireTenantOrganizationId(ctx.organizationId),
        userRole: ctx.userRole,
        user: ctx.user,
      };

      await assertGroupBelongsToTenant(tenantContext, input.groupId);
      await assertCanManageGroup(tenantContext, input.groupId);

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
          status: 'pending',
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create request',
        });
      }

      return serializeRequestDates(created);
    }),

  // List groups for the organization (used by DomainRequests dropdown)
  listGroups: tenantProcedure.query(async ({ ctx }) => {
    const organizationId = requireTenantOrganizationId(ctx.organizationId);
    const groupIds = await getAccessibleTenantGroupIds({
      organizationId,
      userRole: ctx.userRole,
      userId: ctx.user.sub,
    });

    if (groupIds.length === 0) return [];

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
    const organizationId = requireTenantOrganizationId(ctx.organizationId);
    const groupIds = await getAccessibleTenantGroupIds({
      organizationId,
      userRole: ctx.userRole,
      userId: ctx.user.sub,
    });

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
      const organizationId = requireTenantOrganizationId(ctx.organizationId);
      const groupIds = await getAccessibleTenantGroupIds({
        organizationId,
        userRole: ctx.userRole,
        userId: ctx.user.sub,
      });

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

      return results.map((request) => serializeRequestDates(request));
    }),

  approve: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const tenantContext: TenantRouterContext = {
      organizationId: requireTenantOrganizationId(ctx.organizationId),
      userRole: ctx.userRole,
      user: ctx.user,
    };

    const request = await getRequestById(input.id);
    const requestGroupId = assertRequestHasGroupId(request);
    assertPendingRequest(request);
    await assertRequestBelongsToTenant(tenantContext, requestGroupId);
    await assertCanManageGroup(tenantContext, requestGroupId);

    const inserted = await openpathDb
      .insert(whitelistRules)
      .values({
        id: `rule-${nanoid(16)}`,
        groupId: requestGroupId,
        type: 'whitelist',
        value: request.domain,
      })
      .onConflictDoNothing({
        target: [whitelistRules.groupId, whitelistRules.type, whitelistRules.value],
      })
      .returning();

    if (inserted.length > 0) {
      // Touch export version + notify OpenPath SSE via LISTEN/NOTIFY
      await publishWhitelistGroupChanged(requestGroupId);
    }

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
      const tenantContext: TenantRouterContext = {
        organizationId: requireTenantOrganizationId(ctx.organizationId),
        userRole: ctx.userRole,
        user: ctx.user,
      };

      const request = await getRequestById(input.id);
      const requestGroupId = assertRequestHasGroupId(request);
      assertPendingRequest(request);
      await assertRequestBelongsToTenant(tenantContext, requestGroupId);
      await assertCanManageGroup(tenantContext, requestGroupId);

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
    const tenantContext: TenantRouterContext = {
      organizationId: requireTenantOrganizationId(ctx.organizationId),
      userRole: ctx.userRole,
      user: ctx.user,
    };

    if (!isOrgAdmin(tenantContext)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
    }

    const request = await getRequestById(input.id);
    const requestGroupId = assertRequestHasGroupId(request);
    await assertRequestBelongsToTenant(tenantContext, requestGroupId);

    await openpathDb.delete(requests).where(eq(requests.id, input.id));

    return { success: true };
  }),
});
