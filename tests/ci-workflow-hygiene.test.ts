import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
  findStaleScheduledMaintenanceRuns,
  parseHygieneDuration,
  runWorkflowHygiene,
} from '../scripts/ci-workflow-hygiene.mjs';

describe('CI workflow hygiene', () => {
  test('parses explicit stale-run windows', () => {
    assert.equal(parseHygieneDuration('90m'), 5_400_000);
    assert.equal(parseHygieneDuration('2h'), 7_200_000);
    assert.equal(parseHygieneDuration('1d'), 86_400_000);
    assert.throws(() => parseHygieneDuration('90'), /Unsupported hygiene duration/);
  });

  test('reports only stale queued or in-progress scheduled maintenance-safe runs', () => {
    const now = new Date('2026-05-07T12:00:00.000Z');
    const runs = [
      {
        databaseId: 101,
        workflowName: 'Production Client Update Canary',
        event: 'schedule',
        status: 'queued',
        conclusion: '',
        createdAt: '2026-05-07T09:30:00.000Z',
        updatedAt: '2026-05-07T09:30:00.000Z',
        url: 'https://github.example/runs/101',
      },
      {
        databaseId: 102,
        workflowName: 'Sync OpenPath',
        event: 'schedule',
        status: 'in_progress',
        conclusion: '',
        createdAt: '2026-05-07T09:45:00.000Z',
        updatedAt: '2026-05-07T09:45:00.000Z',
        url: 'https://github.example/runs/102',
      },
      {
        databaseId: 103,
        workflowName: 'Production Client Update Canary',
        event: 'schedule',
        status: 'in_progress',
        conclusion: '',
        createdAt: '2026-05-07T11:10:00.000Z',
        updatedAt: '2026-05-07T11:10:00.000Z',
      },
      {
        databaseId: 104,
        workflowName: 'Production Client Update Canary',
        event: 'workflow_dispatch',
        status: 'in_progress',
        conclusion: '',
        createdAt: '2026-05-07T09:00:00.000Z',
        updatedAt: '2026-05-07T09:00:00.000Z',
      },
      {
        databaseId: 105,
        workflowName: 'Deploy',
        event: 'push',
        status: 'in_progress',
        conclusion: '',
        headBranch: 'v1.2.300',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:00:00.000Z',
      },
      {
        databaseId: 106,
        workflowName: 'Release Candidate Images',
        event: 'push',
        status: 'queued',
        conclusion: '',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:00:00.000Z',
      },
      {
        databaseId: 107,
        workflowName: 'Sync OpenPath',
        event: 'schedule',
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:00:00.000Z',
      },
    ];

    const stale = findStaleScheduledMaintenanceRuns({
      runs,
      now,
      staleAfterMs: parseHygieneDuration('90m'),
      currentRunId: 1020,
      workflowPolicies: DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
    });

    assert.deepEqual(
      stale.map((run) => run.databaseId),
      [101, 102]
    );
    assert.ok(stale.every((run) => run.action === 'report-only'));
  });

  test('defaults to dry-run reporting and never cancels without explicit opt-in', async () => {
    const cancelled: string[] = [];
    const result = await runWorkflowHygiene({
      now: new Date('2026-05-07T12:00:00.000Z'),
      staleAfter: '90m',
      workflowPolicies: DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
      listRuns: async () => [
        {
          databaseId: 201,
          workflowName: 'Sync OpenPath',
          event: 'schedule',
          status: 'in_progress',
          conclusion: '',
          createdAt: '2026-05-07T09:00:00.000Z',
          updatedAt: '2026-05-07T09:00:00.000Z',
          url: 'https://github.example/runs/201',
        },
      ],
      cancelRun: async (runId) => {
        cancelled.push(String(runId));
      },
    });

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.cancelEnabled, false);
    assert.deepEqual(cancelled, []);
    assert.deepEqual(
      result.staleRuns.map((run) => run.databaseId),
      [201]
    );
  });

  test('cancels only eligible stale scheduled maintenance runs after explicit opt-in', async () => {
    const cancelled: string[] = [];
    const result = await runWorkflowHygiene({
      cancel: true,
      confirmCancel: true,
      now: new Date('2026-05-07T12:00:00.000Z'),
      staleAfter: '90m',
      workflowPolicies: DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
      listRuns: async () => [
        {
          databaseId: 301,
          workflowName: 'Sync OpenPath',
          event: 'schedule',
          status: 'queued',
          conclusion: '',
          createdAt: '2026-05-07T09:00:00.000Z',
          updatedAt: '2026-05-07T09:00:00.000Z',
        },
        {
          databaseId: 302,
          workflowName: 'Deploy',
          event: 'push',
          status: 'in_progress',
          conclusion: '',
          headBranch: 'v1.2.300',
          createdAt: '2026-05-07T08:00:00.000Z',
          updatedAt: '2026-05-07T08:00:00.000Z',
        },
        {
          databaseId: 303,
          workflowName: 'Production Client Update Canary',
          event: 'workflow_dispatch',
          status: 'in_progress',
          conclusion: '',
          createdAt: '2026-05-07T08:00:00.000Z',
          updatedAt: '2026-05-07T08:00:00.000Z',
        },
      ],
      cancelRun: async (runId) => {
        cancelled.push(String(runId));
      },
    });

    assert.equal(result.mode, 'cancel');
    assert.equal(result.cancelEnabled, true);
    assert.deepEqual(cancelled, ['301']);
    assert.deepEqual(
      result.staleRuns.map((run) => [run.databaseId, run.action]),
      [[301, 'cancelled']]
    );
  });
});
