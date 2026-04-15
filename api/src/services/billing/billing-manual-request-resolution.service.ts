import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { db, schema } from '../../db/index.js';
import { BILLING_AUDIT_TARGET_ENTITLEMENT, BILLING_AUDIT_TARGET_REQUEST } from './billing-types.js';
import {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  recordBillingAuditEvent,
} from './billing-store.js';

async function getPendingManualBillingRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(schema.cpBillingManualRequests)
    .where(
      and(
        eq(schema.cpBillingManualRequests.id, requestId),
        eq(schema.cpBillingManualRequests.status, 'pending')
      )
    )
    .limit(1);

  if (!request) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual billing request not found' });
  }

  return request;
}

function assertResolutionNote(resolutionNote: string): string {
  const trimmedNote = resolutionNote.trim();
  if (!trimmedNote) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Resolution note is required' });
  }
  return trimmedNote;
}

export async function approveManualBillingRequest(params: {
  requestId: string;
  reviewedBy: string;
  resolutionNote: string;
}): Promise<{ organizationId: string }> {
  const request = await getPendingManualBillingRequest(params.requestId);
  const trimmedNote = assertResolutionNote(params.resolutionNote);

  const result = request.organizationId
    ? await activateExistingOrganizationEntitlement({
        userId: request.userId,
        organizationId: request.organizationId,
        classrooms: request.classrooms,
        source: 'manual',
        productKind: request.kind,
        grantedBy: params.reviewedBy,
      })
    : await createOrganizationWithEntitlement({
        userId: request.userId,
        organizationName: request.organizationName,
        classrooms: request.classrooms,
        source: 'manual',
        productKind: request.kind,
        grantedBy: params.reviewedBy,
      });

  await db
    .update(schema.cpBillingManualRequests)
    .set({
      status: 'approved',
      organizationId: result.organizationId,
      resolutionNote: trimmedNote,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingManualRequests.id, request.id));

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'manual-request.approved',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: request.id,
    metadata: {
      resolutionNote: trimmedNote,
      classrooms: request.classrooms,
      kind: request.kind,
    },
  });

  await recordBillingAuditEvent({
    organizationId: result.organizationId,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'entitlement.activated',
    targetType: BILLING_AUDIT_TARGET_ENTITLEMENT,
    targetId: result.organizationId,
    metadata: {
      source: 'manual',
      productKind: request.kind,
      classrooms: request.classrooms,
      resolutionNote: trimmedNote,
    },
  });

  return { organizationId: result.organizationId };
}

export async function rejectManualBillingRequest(params: {
  requestId: string;
  reviewedBy: string;
  resolutionNote: string;
}): Promise<{ requestId: string }> {
  const request = await getPendingManualBillingRequest(params.requestId);
  const trimmedNote = assertResolutionNote(params.resolutionNote);

  await db
    .update(schema.cpBillingManualRequests)
    .set({
      status: 'rejected',
      resolutionNote: trimmedNote,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.cpBillingManualRequests.id, request.id));

  await recordBillingAuditEvent({
    organizationId: request.organizationId ?? null,
    actorType: 'platform_admin',
    actorId: params.reviewedBy,
    action: 'manual-request.rejected',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: request.id,
    metadata: {
      resolutionNote: trimmedNote,
      classrooms: request.classrooms,
      kind: request.kind,
    },
  });

  return { requestId: request.id };
}
