import { db, schema } from '../../db/index.js';
import { generateId } from '../../lib/id.js';
import { BILLING_AUDIT_TARGET_REQUEST, type ManualRequest } from './billing-types.js';
import { getExistingBillingOrganization, recordBillingAuditEvent } from './billing-store.js';
import { assertClassroomCount } from './billing-utils.js';

export async function createManualBillingRequest(input: ManualRequest): Promise<{
  requestId: string;
}> {
  assertClassroomCount(input.classrooms);
  const requestId = generateId('bill_req');
  const existingOrganization = await getExistingBillingOrganization(input.userId);

  await db.insert(schema.cpBillingManualRequests).values({
    id: requestId,
    userId: input.userId,
    organizationId: existingOrganization?.id ?? null,
    organizationName: existingOrganization?.name ?? input.organizationName,
    kind: input.kind,
    classrooms: input.classrooms,
    status: 'pending',
    note: input.note ?? null,
  });

  await recordBillingAuditEvent({
    organizationId: existingOrganization?.id ?? null,
    actorType: 'user',
    actorId: input.userId,
    action: 'manual-request.created',
    targetType: BILLING_AUDIT_TARGET_REQUEST,
    targetId: requestId,
    metadata: {
      kind: input.kind,
      classrooms: input.classrooms,
      note: input.note ?? null,
    },
  });

  return { requestId };
}
