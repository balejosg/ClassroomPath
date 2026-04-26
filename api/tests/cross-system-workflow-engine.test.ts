import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMutationOperationById,
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
} from '../src/lib/cross-system-mutations.js';
import {
  runDeleteMutationWorkflow,
  runLocalFirstMutationWorkflow,
  runMutationWorkflow,
  runUpstreamFirstProvisioningWorkflow,
} from '../src/lib/cross-system-workflow-engine.js';
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

  void test('local-first family resumes after local commit without repeating local work', async () => {
    await withTestDbLock(async () => {
      await resetDb();

      const operation = await getOrCreateMutationOperation({
        operationType: 'workflow.local_first',
        idempotencyKey: 'local-first-resume',
        metadata: { family: 'local-first' },
      });

      await setMutationOperationProgress(operation.id, {
        step: 'local_committed',
        result: { membershipId: 'mem_resume' },
      });

      const resumed = await getMutationOperationById(operation.id);
      assert.ok(resumed);

      let localCommits = 0;
      let upstreamSyncs = 0;
      let completions = 0;

      const workflow = await runLocalFirstMutationWorkflow({
        operation: resumed,
        initialResult: getMutationResult<{ membershipId: string }>(resumed),
        initialState: {},
        metadata: resumed.metadata,
        commitLocal: async () => {
          localCommits += 1;
          return { result: { membershipId: 'mem_new' } };
        },
        syncUpstream: async ({ result }) => {
          upstreamSyncs += 1;
          return { result: result ?? { membershipId: 'mem_missing' } };
        },
        complete: async ({ result }) => {
          completions += 1;
          return { result: result ?? { membershipId: 'mem_missing' } };
        },
      });

      assert.equal(localCommits, 0);
      assert.equal(upstreamSyncs, 1);
      assert.equal(completions, 1);
      assert.deepEqual(workflow.result, { membershipId: 'mem_resume' });

      const completed = await getMutationOperationById(operation.id);
      assert.equal(completed?.status, 'completed');
      assert.equal(completed?.currentStep, 'completed');
    });
  });

  void test('upstream-first family resumes from stored upstream result before linking locally', async () => {
    await withTestDbLock(async () => {
      await resetDb();

      const operation = await getOrCreateMutationOperation({
        operationType: 'workflow.upstream_first',
        idempotencyKey: 'upstream-first-resume',
        metadata: { family: 'upstream-first' },
      });

      await setMutationOperationProgress(operation.id, {
        step: 'upstream_created',
        result: { classroomId: 'classroom_resume' },
      });

      const resumed = await getMutationOperationById(operation.id);
      assert.ok(resumed);

      let upstreamCreates = 0;
      let localLinks = 0;
      let completions = 0;

      const workflow = await runUpstreamFirstProvisioningWorkflow({
        operation: resumed,
        initialResult: getMutationResult<{ classroomId: string }>(resumed),
        initialState: {},
        metadata: resumed.metadata,
        createUpstream: async () => {
          upstreamCreates += 1;
          return { result: { classroomId: 'classroom_new' } };
        },
        linkLocal: async ({ result }) => {
          localLinks += 1;
          return { result: result ?? { classroomId: 'classroom_missing' } };
        },
        complete: async ({ result }) => {
          completions += 1;
          return { result: result ?? { classroomId: 'classroom_missing' } };
        },
      });

      assert.equal(upstreamCreates, 0);
      assert.equal(localLinks, 1);
      assert.equal(completions, 1);
      assert.deepEqual(workflow.result, { classroomId: 'classroom_resume' });

      const completed = await getMutationOperationById(operation.id);
      assert.equal(completed?.status, 'completed');
      assert.equal(completed?.currentStep, 'completed');
    });
  });

  void test('delete family retries from the ledger result and completes cleanup', async () => {
    await withTestDbLock(async () => {
      await resetDb();

      const operation = await getOrCreateMutationOperation({
        operationType: 'workflow.delete',
        idempotencyKey: 'delete-retry',
        metadata: { family: 'delete' },
      });

      await setMutationOperationProgress(operation.id, {
        step: 'local_committed',
        status: 'failed',
        result: { success: true, groupId: 'group_resume' },
        lastError: { message: 'upstream cleanup failed' },
      });

      const resumed = await getMutationOperationById(operation.id);
      assert.ok(resumed);

      let localDeletes = 0;
      let cleanupRuns = 0;

      const workflow = await runDeleteMutationWorkflow({
        operation: resumed,
        initialResult: getMutationResult<{ success: true; groupId: string }>(resumed),
        initialState: {},
        metadata: resumed.metadata,
        commitLocalDelete: async () => {
          localDeletes += 1;
          return { result: { success: true, groupId: 'group_new' } };
        },
        completeDelete: async ({ result }) => {
          cleanupRuns += 1;
          return { result: result ?? { success: true, groupId: 'group_missing' } };
        },
      });

      assert.equal(localDeletes, 0);
      assert.equal(cleanupRuns, 1);
      assert.deepEqual(workflow.result, { success: true, groupId: 'group_resume' });

      const completed = await getMutationOperationById(operation.id);
      assert.equal(completed?.status, 'completed');
      assert.equal(completed?.lastError, null);
    });
  });
});
