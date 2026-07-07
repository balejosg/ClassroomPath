import { getGroupsByIds } from '../db/openpath-repos/groups.repo.js';
import {
  getRequestsByGroupIds,
  listRequestsByGroupIds,
} from '../db/openpath-repos/requests.repo.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import { getAccessibleRequestGroupIds, serializeRequestDates } from './request-shared.service.js';

export async function listAccessibleRequestGroups(ctx: TenantProcedureContext) {
  const groupIds = await getAccessibleRequestGroupIds(ctx);

  if (groupIds.length === 0) return [];

  const groups = await getGroupsByIds(groupIds);

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

  const allRequests = await getRequestsByGroupIds(groupIds);

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

  const results = await listRequestsByGroupIds({ groupIds, status });

  return results.map((request) => serializeRequestDates(request));
}
