import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import { generateId } from '../../lib/id.js';
import {
  BILLING_AUDIT_TARGET_REQUEST,
  type BillingActorType,
  type BillingAuditTrailEntryDto,
} from './billing-types.js';
import { toIso } from './billing-utils.js';

export async function recordBillingAuditEvent(params: {
  organizationId?: string | null;
  actorType: BillingActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.cpBillingAuditEvents).values({
    id: generateId('bill_audit'),
    organizationId: params.organizationId ?? null,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata ?? {},
  });
}

export async function getBillingAuditTrail(
  filters: {
    organizationId?: string;
    requestId?: string;
  } = {}
): Promise<BillingAuditTrailEntryDto[]> {
  let rows: Array<typeof schema.cpBillingAuditEvents.$inferSelect>;

  if (filters.organizationId && filters.requestId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(
        and(
          eq(schema.cpBillingAuditEvents.organizationId, filters.organizationId),
          eq(schema.cpBillingAuditEvents.targetType, BILLING_AUDIT_TARGET_REQUEST),
          eq(schema.cpBillingAuditEvents.targetId, filters.requestId)
        )
      )
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else if (filters.organizationId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(eq(schema.cpBillingAuditEvents.organizationId, filters.organizationId))
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else if (filters.requestId) {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .where(
        and(
          eq(schema.cpBillingAuditEvents.targetType, BILLING_AUDIT_TARGET_REQUEST),
          eq(schema.cpBillingAuditEvents.targetId, filters.requestId)
        )
      )
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  } else {
    rows = await db
      .select()
      .from(schema.cpBillingAuditEvents)
      .orderBy(desc(schema.cpBillingAuditEvents.createdAt));
  }

  return rows.slice(0, 100).map((row) => ({
    id: row.id,
    organizationId: row.organizationId ?? null,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: toIso(row.createdAt),
  }));
}
