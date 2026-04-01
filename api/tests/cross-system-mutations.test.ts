import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import {
  getMutationOperationById,
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
} from '../src/lib/cross-system-mutations.js';
import { resetDb, withTestDbLock } from './test-db.js';

describe('cross-system-mutations', () => {
  afterEach(async () => {
    await withTestDbLock(async () => {
      await resetDb();
    });
  });

  test('creates, resumes, and completes a durable mutation record', async () => {
    await withTestDbLock(async () => {
      const operation = await getOrCreateMutationOperation({
        operationType: 'test.operation',
        idempotencyKey: 'user-1',
        userId: 'user-1',
        metadata: { source: 'test' },
      });

      assert.strictEqual(operation.status, 'in_progress');
      assert.strictEqual(operation.currentStep, 'pending');

      await setMutationOperationProgress(operation.id, {
        step: 'local_committed',
        result: { membershipId: 'mem_1' },
      });

      const resumed = await getOrCreateMutationOperation({
        operationType: 'test.operation',
        idempotencyKey: 'user-1',
        userId: 'user-1',
      });

      assert.strictEqual(resumed.id, operation.id);
      assert.strictEqual(resumed.currentStep, 'local_committed');
      assert.deepStrictEqual(getMutationResult<{ membershipId: string }>(resumed), {
        membershipId: 'mem_1',
      });

      await setMutationOperationProgress(operation.id, {
        step: 'completed',
        status: 'completed',
        result: { membershipId: 'mem_1' },
        completed: true,
      });

      const completed = await getMutationOperationById(operation.id);
      assert.ok(completed);
      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.currentStep, 'completed');
    });
  });

  test('stores failure details for later retry', async () => {
    await withTestDbLock(async () => {
      const operation = await getOrCreateMutationOperation({
        operationType: 'test.failure',
        idempotencyKey: 'user-2',
        userId: 'user-2',
      });

      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        lastError: { message: 'sync failed' },
      });

      const [stored] = await db
        .select()
        .from(schema.cpMutationOperations)
        .where(eq(schema.cpMutationOperations.id, operation.id))
        .limit(1);

      assert.ok(stored);
      assert.strictEqual(stored.status, 'failed');
      assert.deepStrictEqual(stored.lastError, { message: 'sync failed' });
    });
  });
});
