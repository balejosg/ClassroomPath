import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  openpathDb,
  publishWhitelistGroupChanged,
  requests,
  whitelistGroups,
  whitelistRules,
} from '../db/openpath.js';
import { assertCanUseGroup, getAccessibleTenantGroupIds } from '../lib/tenant-access.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import { orgHasGroup } from './org-group-membership.service.js';

type TenantRequestRow = typeof requests.$inferSelect;

async function assertGroupBelongsToTenant(
  ctx: TenantProcedureContext,
  groupId: string
): Promise<void> {
  const inTenant = await orgHasGroup({ organizationId: ctx.organizationId, groupId });
  if (!inTenant) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Group does not belong to tenant',
    });
  }
}

async function assertCanManageGroup(ctx: TenantProcedureContext, groupId: string): Promise<void> {
  await assertCanUseGroup(ctx, groupId, {
    notTeacherMessage: 'Insufficient permissions for this group',
    notAllowedMessage: 'Insufficient permissions for this group',
  });
}

async function assertRequestBelongsToTenant(
  ctx: TenantProcedureContext,
  requestGroupId: string
): Promise<void> {
  const inTenant = await orgHasGroup({
    organizationId: ctx.organizationId,
    groupId: requestGroupId,
  });
  if (!inTenant) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Request does not belong to tenant' });
  }
}

async function getRequestById(requestId: string): Promise<TenantRequestRow> {
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

export function assertRequestHasGroupId(request: { groupId: string | null }): string {
  if (!request.groupId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request has no group assigned' });
  }
  return request.groupId;
}

export function assertPendingRequest(request: { status: string }): void {
  if (request.status !== 'pending') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
  }
}

export function serializeRequestDates<T extends { createdAt: Date | null; updatedAt: Date | null }>(
  request: T
) {
  return {
    ...request,
    createdAt: request.createdAt?.toISOString() ?? null,
    updatedAt: request.updatedAt?.toISOString() ?? null,
  };
}

export async function createTenantRequest(params: {
  ctx: TenantProcedureContext;
  input: {
    domain: string;
    groupId: string;
    reason?: string;
    requesterEmail?: string;
  };
}) {
  await assertGroupBelongsToTenant(params.ctx, params.input.groupId);
  await assertCanManageGroup(params.ctx, params.input.groupId);

  const pendingRequest = await openpathDb
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        sql`LOWER(${requests.domain}) = LOWER(${params.input.domain})`,
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
      domain: params.input.domain.toLowerCase(),
      reason: params.input.reason ?? 'No reason provided',
      requesterEmail:
        params.input.requesterEmail ?? params.ctx.user.email ?? 'anonymous@tenant.local',
      groupId: params.input.groupId,
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
}

export async function listAccessibleRequestGroups(ctx: TenantProcedureContext) {
  const groupIds = await getAccessibleTenantGroupIds({
    organizationId: ctx.organizationId,
    userRole: ctx.userRole,
    userId: ctx.user.sub,
  });

  if (groupIds.length === 0) return [];

  const groups = await openpathDb
    .select()
    .from(whitelistGroups)
    .where(inArray(whitelistGroups.id, groupIds));

  return groups.map((group) => ({
    name: group.displayName ?? group.name,
    path: group.id,
  }));
}

export async function getTenantRequestStats(ctx: TenantProcedureContext) {
  const groupIds = await getAccessibleTenantGroupIds({
    organizationId: ctx.organizationId,
    userRole: ctx.userRole,
    userId: ctx.user.sub,
  });

  if (groupIds.length === 0) {
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  }

  const allRequests = await openpathDb
    .select()
    .from(requests)
    .where(inArray(requests.groupId, groupIds));

  return {
    total: allRequests.length,
    pending: allRequests.filter((request) => request.status === 'pending').length,
    approved: allRequests.filter((request) => request.status === 'approved').length,
    rejected: allRequests.filter((request) => request.status === 'rejected').length,
  };
}

export async function listTenantRequests(
  ctx: TenantProcedureContext,
  status?: 'pending' | 'approved' | 'rejected'
) {
  const groupIds = await getAccessibleTenantGroupIds({
    organizationId: ctx.organizationId,
    userRole: ctx.userRole,
    userId: ctx.user.sub,
  });

  if (groupIds.length === 0) return [];

  const conditions = [inArray(requests.groupId, groupIds)];
  if (status) {
    conditions.push(eq(requests.status, status));
  }

  const results = await openpathDb
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(requests.createdAt);

  return results.map((request) => serializeRequestDates(request));
}

export async function approveTenantRequest(
  ctx: TenantProcedureContext,
  requestId: string
): Promise<{ success: true }> {
  const request = await getRequestById(requestId);
  const requestGroupId = assertRequestHasGroupId(request);
  assertPendingRequest(request);
  await assertRequestBelongsToTenant(ctx, requestGroupId);
  await assertCanManageGroup(ctx, requestGroupId);

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
    .where(eq(requests.id, requestId));

  return { success: true };
}

export async function rejectTenantRequest(
  ctx: TenantProcedureContext,
  requestId: string,
  reason?: string
): Promise<{ success: true }> {
  const request = await getRequestById(requestId);
  const requestGroupId = assertRequestHasGroupId(request);
  assertPendingRequest(request);
  await assertRequestBelongsToTenant(ctx, requestGroupId);
  await assertCanManageGroup(ctx, requestGroupId);

  await openpathDb
    .update(requests)
    .set({
      status: 'rejected',
      updatedAt: new Date(),
      resolvedAt: new Date(),
      resolvedBy: ctx.user.name,
      resolutionNote: reason ?? null,
    })
    .where(eq(requests.id, requestId));

  return { success: true };
}

export async function deleteTenantRequest(
  ctx: TenantProcedureContext,
  requestId: string
): Promise<{ success: true }> {
  const request = await getRequestById(requestId);
  const requestGroupId = assertRequestHasGroupId(request);
  await assertRequestBelongsToTenant(ctx, requestGroupId);

  await openpathDb.delete(requests).where(eq(requests.id, requestId));

  return { success: true };
}
