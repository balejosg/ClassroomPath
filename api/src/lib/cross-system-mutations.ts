import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { DbExecutor } from '../db/index.js';
import { generateId } from './id.js';

export type CrossSystemMutationStatus = 'in_progress' | 'completed' | 'failed';

export type CrossSystemMutationStep =
  | 'pending'
  | 'upstream_created'
  | 'local_linked'
  | 'local_committed'
  | 'synced_upstream'
  | 'audited'
  | 'completed'
  | 'failed';

export interface MutationOperationRecord {
  id: string;
  operationType: string;
  idempotencyKey: string;
  status: CrossSystemMutationStatus;
  currentStep: string;
  organizationId: string | null;
  userId: string | null;
  metadata: Record<string, unknown>;
  result: Record<string, unknown>;
  lastError: Record<string, unknown> | null;
}

function toRecord(row: typeof schema.cpMutationOperations.$inferSelect): MutationOperationRecord {
  return {
    id: row.id,
    operationType: row.operationType,
    idempotencyKey: row.idempotencyKey,
    status: row.status as CrossSystemMutationStatus,
    currentStep: row.currentStep,
    organizationId: row.organizationId ?? null,
    userId: row.userId ?? null,
    metadata: row.metadata ?? {},
    result: row.result ?? {},
    lastError: row.lastError ?? null,
  };
}

export async function getOrCreateMutationOperation(params: {
  operationType: string;
  idempotencyKey: string;
  organizationId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<MutationOperationRecord> {
  await db
    .insert(schema.cpMutationOperations)
    .values({
      id: generateId('mut'),
      operationType: params.operationType,
      idempotencyKey: params.idempotencyKey,
      status: 'in_progress',
      currentStep: 'pending',
      organizationId: params.organizationId ?? null,
      userId: params.userId ?? null,
      metadata: params.metadata ?? {},
      result: {},
      lastError: null,
    })
    .onConflictDoNothing();

  const [operation] = await db
    .select()
    .from(schema.cpMutationOperations)
    .where(
      and(
        eq(schema.cpMutationOperations.operationType, params.operationType),
        eq(schema.cpMutationOperations.idempotencyKey, params.idempotencyKey)
      )
    )
    .limit(1);

  if (!operation) {
    throw new Error('Failed to load mutation operation');
  }

  return toRecord(operation);
}

export async function setMutationOperationProgress(
  operationId: string,
  params: {
    step: CrossSystemMutationStep;
    status?: CrossSystemMutationStatus;
    organizationId?: string | null;
    userId?: string | null;
    result?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    lastError?: Record<string, unknown> | null;
    completed?: boolean;
  },
  executor: DbExecutor = db
): Promise<void> {
  const updates: Partial<typeof schema.cpMutationOperations.$inferInsert> = {
    currentStep: params.step,
    updatedAt: new Date(),
  };

  if (params.status !== undefined) {
    updates.status = params.status;
  }

  if (params.organizationId !== undefined) {
    updates.organizationId = params.organizationId;
  }

  if (params.userId !== undefined) {
    updates.userId = params.userId;
  }

  if (params.result !== undefined) {
    updates.result = params.result;
  }

  if (params.metadata !== undefined) {
    updates.metadata = params.metadata;
  }

  if (params.lastError !== undefined) {
    updates.lastError = params.lastError;
  }

  if (params.completed) {
    updates.completedAt = new Date();
  }

  await executor
    .update(schema.cpMutationOperations)
    .set(updates)
    .where(eq(schema.cpMutationOperations.id, operationId));
}

export async function getMutationOperationById(
  operationId: string
): Promise<MutationOperationRecord | null> {
  const [operation] = await db
    .select()
    .from(schema.cpMutationOperations)
    .where(eq(schema.cpMutationOperations.id, operationId))
    .limit(1);

  return operation ? toRecord(operation) : null;
}

export async function listMutationOperations(params?: {
  organizationId?: string;
  status?: CrossSystemMutationStatus;
}): Promise<MutationOperationRecord[]> {
  const conditions = [];

  if (params?.organizationId !== undefined) {
    conditions.push(eq(schema.cpMutationOperations.organizationId, params.organizationId));
  }

  if (params?.status !== undefined) {
    conditions.push(eq(schema.cpMutationOperations.status, params.status));
  }

  const rows = await db
    .select()
    .from(schema.cpMutationOperations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.cpMutationOperations.updatedAt));

  return rows.map(toRecord);
}

export function getMutationResult<T extends Record<string, unknown>>(
  operation: Pick<MutationOperationRecord, 'result'>
): T | null {
  return Object.keys(operation.result).length > 0 ? (operation.result as T) : null;
}

export function toMutationError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}
