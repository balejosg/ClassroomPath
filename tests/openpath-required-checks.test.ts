import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenPathCiRecoveryScenario } from './helpers/release-fixtures.ts';
import {
  evaluateRequiredChecks,
  OPENPATH_CI_JOB_NAMES,
} from '../scripts/lib/openpath-ci-checks.mjs';

function buildCompletedWorkflowJob(name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-03-13T10:00:00Z',
    steps: [
      {
        name: 'Set up job',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Complete job',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    ...overrides,
  };
}

describe('evaluateRequiredChecks', () => {
  it('accepts the latest success for every required check', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('fails when a required check is missing', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['E2E Summary']);
    assert.deepEqual(result.failing, []);
  });

  it('fails when the latest run of a required check is not successful', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:02:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, [
      {
        conclusion: 'failure',
        name: 'CI Success',
        status: 'completed',
      },
    ]);
  });

  it('deduplicates retries by keeping the latest run per check name', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:05:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success from workflow jobs when the summary check is missing', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: OPENPATH_CI_JOB_NAMES.map((jobName) => buildCompletedWorkflowJob(jobName)),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success when the windows job is stuck in progress after all steps succeed', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Upload test results',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Complete job',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success when the windows job is marked failed after all steps succeed', () => {
    const fixture = buildOpenPathCiRecoveryScenario();
    const result = evaluateRequiredChecks({
      checkRuns: fixture.checkRuns,
      requiredChecks: ['CI Success'],
      workflowJobs: fixture.workflowJobs,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('does not recover CI Success when a required workflow job actually fails', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'completed',
          conclusion: 'failure',
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'completed',
              conclusion: 'failure',
            },
            {
              name: 'Complete job',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['CI Success']);
    assert.deepEqual(result.failing, []);
  });

  it('does not recover CI Success when a workflow job is still genuinely running', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'in_progress',
              conclusion: null,
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['CI Success']);
    assert.deepEqual(result.failing, []);
  });
});
