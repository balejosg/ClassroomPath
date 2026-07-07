import { resolveRequest } from '../db/openpath-repos/requests.repo.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import {
  assertCanManageGroup,
  assertPendingRequest,
  assertRequestBelongsToTenant,
  assertRequestHasGroupId,
  getRequestById,
} from './request-shared.service.js';

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

  await resolveRequest(requestId, {
    status: 'rejected',
    resolvedBy: ctx.user.name,
    resolutionNote: reason ?? null,
  });

  return { success: true };
}
