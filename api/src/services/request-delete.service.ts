import { eq } from 'drizzle-orm';

import { openpathDb, requests } from '../db/openpath.js';
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

  await openpathDb.delete(requests).where(eq(requests.id, requestId));

  return { success: true };
}
