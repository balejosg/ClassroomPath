import { eq } from 'drizzle-orm';

import { openpathDb, requests } from '../db/openpath.js';
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
