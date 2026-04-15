import { and, eq, inArray } from 'drizzle-orm';

import { openpathDb, requests, whitelistGroups } from '../db/openpath.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import { getAccessibleRequestGroupIds, serializeRequestDates } from './request-shared.service.js';

export async function listAccessibleRequestGroups(ctx: TenantProcedureContext) {
  const groupIds = await getAccessibleRequestGroupIds(ctx);

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
  const groupIds = await getAccessibleRequestGroupIds(ctx);

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
  const groupIds = await getAccessibleRequestGroupIds(ctx);

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
