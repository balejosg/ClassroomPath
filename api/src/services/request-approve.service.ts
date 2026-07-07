import { nanoid } from 'nanoid';

import { insertRuleIfAbsentAndPublish } from '../db/openpath-repos/whitelist-rules.repo.js';
import { resolveRequest } from '../db/openpath-repos/requests.repo.js';
import { getRootDomain } from '../openpath/domain.js';
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

  await insertRuleIfAbsentAndPublish({
    id: `rule-${nanoid(16)}`,
    groupId: requestGroupId,
    type: 'whitelist',
    value: getRootDomain(request.domain),
  });

  await resolveRequest(requestId, {
    status: 'approved',
    resolvedBy: ctx.user.name,
    resolutionNote: 'Approved from tenant gateway',
  });

  return { success: true };
}
