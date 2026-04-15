import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import {
  openpathDb,
  publishWhitelistGroupChanged,
  requests,
  whitelistRules,
} from '../db/openpath.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import {
  assertCanManageGroup,
  assertPendingRequest,
  assertRequestBelongsToTenant,
  assertRequestHasGroupId,
  getRequestById,
} from './request-shared.service.js';

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
