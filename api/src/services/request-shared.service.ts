import { TRPCError } from '@trpc/server';

import {
  getRequestById as getRequestRowById,
  type RequestRow,
} from '../db/openpath-repos/requests.repo.js';
import { assertCanUseGroup, getAccessibleTenantGroupIds } from '../lib/tenant-access.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import { orgHasGroup } from './org-group-membership.service.js';

export type TenantRequestRow = RequestRow;

export async function assertGroupBelongsToTenant(
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

export async function assertCanManageGroup(
  ctx: TenantProcedureContext,
  groupId: string
): Promise<void> {
  await assertCanUseGroup(ctx, groupId, {
    notTeacherMessage: 'Insufficient permissions for this group',
    notAllowedMessage: 'Insufficient permissions for this group',
  });
}

export async function assertRequestBelongsToTenant(
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

export async function getRequestById(requestId: string): Promise<TenantRequestRow> {
  const request = await getRequestRowById(requestId);

  if (!request) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
  }

  return request;
}

export async function getAccessibleRequestGroupIds(ctx: TenantProcedureContext): Promise<string[]> {
  return getAccessibleTenantGroupIds({
    organizationId: ctx.organizationId,
    userRole: ctx.userRole,
    userId: ctx.user.sub,
  });
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
