import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMutationOperationById,
  getOrCreateMutationOperation,
} from '../src/lib/cross-system-mutations.js';
import { runMutationWorkflow } from '../src/lib/cross-system-workflow-engine.js';
import { resetDb, withTestDbLock } from './test-db.js';

void describe('cross-system-workflow-engine', () => {
  void test('runs workflow steps, merging state and metadata into persisted progress', async () => {
    await withTestDbLock(async () => {
      await resetDb();

      const operation = await getOrCreateMutationOperation({
        operationType: 'workflow.test',
        idempotencyKey: 'workflow-success',
        metadata: { seed: 'initial' },
      });

      const workflow = await runMutationWorkflow({
        operation,
        initialResult: null,
        initialState: { count: 0 },
        metadata: { seed: 'initial' },
        steps: [
          {
            step: 'local_committed',
            run: async () => ({
              metadata: { local: 'done' },
              result: { membershipId: 'mem_workflow_test' },
              state: (current) => ({ count: current.count + 1 }),
            }),
          },
          {
            step: 'completed',
            completed: true,
            run: async ({ result, state }) => ({
              metadata: { finalized: true },
              result: {
                membershipId: result?.membershipId ?? 'mem_workflow_test',
                count: state.count,
              },
              state: { count: state.count + 1 },
            }),
          },
        ],
      });

      assert.deepEqual(workflow.state, { count: 2 });
      assert.deepEqual(workflow.metadata, {
        seed: 'initial',
        local: 'done',
        finalized: true,
      });
      assert.deepEqual(workflow.result, {
        membershipId: 'mem_workflow_test',
        count: 1,
      });

      const persisted = await getMutationOperationById(operation.id);
      assert.ok(persisted);
      assert.equal(persisted?.status, 'completed');
      assert.equal(persisted?.currentStep, 'completed');
      assert.deepEqual(persisted?.metadata, workflow.metadata);
      assert.deepEqual(persisted?.result, workflow.result);
      assert.equal(persisted?.lastError, null);
    });
  });

  void test('marks the operation as failed when a workflow step throws', async () => {
    await withTestDbLock(async () => {
      await resetDb();

      const operation = await getOrCreateMutationOperation({
        operationType: 'workflow.test',
        idempotencyKey: 'workflow-failure',
      });

      await assert.rejects(
        runMutationWorkflow({
          operation,
          initialResult: null,
          initialState: { count: 0 },
          metadata: { seed: 'initial' },
          steps: [
            {
              step: 'local_committed',
              run: async () => {
                throw new Error('workflow exploded');
              },
            },
          ],
        }),
        /workflow exploded/
      );

      const persisted = await getMutationOperationById(operation.id);
      assert.ok(persisted);
      assert.equal(persisted?.status, 'failed');
      assert.equal(persisted?.currentStep, 'failed');
      assert.deepEqual(persisted?.lastError, {
        name: 'Error',
        message: 'workflow exploded',
      });
    });
  });
});
