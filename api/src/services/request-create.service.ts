import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { and, eq, sql } from 'drizzle-orm';

import { openpathDb, requests } from '../db/openpath.js';
import { logger } from '../lib/logger.js';
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

  const pendingRequest = await openpathDb
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        sql`LOWER(${requests.domain}) = LOWER(${params.input.domain})`,
        eq(requests.status, 'pending')
      )
    )
    .limit(1);

  if (pendingRequest.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Pending request exists for this domain',
    });
  }

  const [created] = await openpathDb
    .insert(requests)
    .values({
      id: `req_${nanoid(8)}`,
      domain: params.input.domain.toLowerCase(),
      reason: params.input.reason ?? 'No reason provided',
      requesterEmail:
        params.input.requesterEmail ?? params.ctx.user.email ?? 'anonymous@tenant.local',
      groupId: params.input.groupId,
      status: 'pending',
    })
    .returning();

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
