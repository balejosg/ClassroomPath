import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import { findPendingRequestIdByDomain, insertRequest } from '../db/openpath-repos/requests.repo.js';
import { logger } from '../lib/logger.js';
import { getRootDomain } from '../openpath/domain.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import {
  assertCanManageGroup,
  assertGroupBelongsToTenant,
  serializeRequestDates,
} from './request-shared.service.js';
import { notifyTenantTeachersOfNewRequest } from './push.service.js';

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
  const normalizedDomain = getRootDomain(params.input.domain);

  const pendingRequestId = await findPendingRequestIdByDomain(normalizedDomain);

  if (pendingRequestId !== undefined) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Pending request exists for this domain',
    });
  }

  const created = await insertRequest({
    id: `req_${nanoid(8)}`,
    domain: normalizedDomain.toLowerCase(),
    reason: params.input.reason ?? 'No reason provided',
    requesterEmail:
      params.input.requesterEmail ?? params.ctx.user.email ?? 'anonymous@tenant.local',
    groupId: params.input.groupId,
    status: 'pending',
  });

  if (!created) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create request',
    });
  }

  void notifyTenantTeachersOfNewRequest(created).catch((error) => {
    // Push delivery is best-effort and must not block request creation.
    logger.warn('Failed to notify teachers of new domain request', {
      requestId: created.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return serializeRequestDates(created);
}
