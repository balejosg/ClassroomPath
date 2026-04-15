import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { generateId } from '../lib/id.js';
import { logger } from '../lib/logger.js';

export type AuditTargetType = 'invitation' | 'user';

export interface AuditEventInput<Metadata extends Record<string, unknown>> {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  metadata: Metadata;
}

export async function recordAuditEvent<Metadata extends Record<string, unknown>>(
  input: AuditEventInput<Metadata>
): Promise<string> {
  const auditEventId = generateId('audit');

  await db.insert(schema.cpAuditEvents).values({
    id: auditEventId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });

  return auditEventId;
}

export async function deleteAuditEventById(auditEventId: string): Promise<void> {
  await db.delete(schema.cpAuditEvents).where(eq(schema.cpAuditEvents.id, auditEventId));
}

export async function deleteAuditEventByIdBestEffort(params: {
  auditEventId: string;
  action: string;
  targetId: string;
}): Promise<void> {
  try {
    await deleteAuditEventById(params.auditEventId);
  } catch (error) {
    logger.warn('Failed to delete audit event during rollback', {
      auditEventId: params.auditEventId,
      action: params.action,
      targetId: params.targetId,
      error: error instanceof Error ? error.message : String(error),
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : undefined,
    });
  }
}
