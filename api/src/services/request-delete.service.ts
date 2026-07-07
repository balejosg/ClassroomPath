import { deleteRequestById } from '../db/openpath-repos/requests.repo.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import {
  assertRequestBelongsToTenant,
  assertRequestHasGroupId,
  getRequestById,
} from './request-shared.service.js';

export async function deleteTenantRequest(
  ctx: TenantProcedureContext,
  requestId: string
): Promise<{ success: true }> {
  const request = await getRequestById(requestId);
  const requestGroupId = assertRequestHasGroupId(request);
  await assertRequestBelongsToTenant(ctx, requestGroupId);

  await deleteRequestById(requestId);

  return { success: true };
}
