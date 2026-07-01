import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectChronicFailures, runActionsHealthCommand } from '../scripts/actions-health.mjs';

function failureRun(id: number, createdAt: string) {
  return {
    databaseId: id,
    conclusion: 'failure',
    status: 'completed',
    event: 'schedule',
    createdAt,
    updatedAt: createdAt,
  };
}

function successRun(id: number, createdAt: string) {
  return {
    databaseId: id,
    conclusion: 'success',
    status: 'completed',
    event: 'schedule',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('detectChronicFailures (pure)', () => {
  it('flags a workflow whose last N runs are all failures, with the right count', () => {
    const runsByWorkflow = new Map([
      [
        'Smoke Tests',
        [
          failureRun(5, '2026-06-30T00:00:00Z'),
          failureRun(4, '2026-06-29T00:00:00Z'),
          failureRun(3, '2026-06-28T00:00:00Z'),
          failureRun(2, '2026-06-27T00:00:00Z'),
          failureRun(1, '2026-06-26T00:00:00Z'),
        ],
      ],
    ]);

    const chronic = detectChronicFailures(runsByWorkflow, 5);

    assert.equal(chronic.length, 1);
    assert.equal(chronic[0].workflowName, 'Smoke Tests');
    assert.equal(chronic[0].consecutiveFailures, 5);
    // first-of-the-streak run = the oldest run within the all-failure window
    assert.equal(chronic[0].streakStartRunId, 1);
    assert.equal(chronic[0].streakStartDate, '2026-06-26T00:00:00Z');
  });

  it('does NOT flag a workflow with a mixed window (failure, failure, success, failure)', () => {
    const runsByWorkflow = new Map([
      [
        'CI Success',
        [
          failureRun(4, '2026-06-30T00:00:00Z'),
          failureRun(3, '2026-06-29T00:00:00Z'),
          successRun(2, '2026-06-28T00:00:00Z'),
          failureRun(1, '2026-06-27T00:00:00Z'),
        ],
      ],
    ]);

    const chronic = detectChronicFailures(runsByWorkflow, 4);

    assert.deepEqual(chronic, []);
  });

  it('treats fewer-than-threshold total runs as NOT chronic (insufficient evidence), even if all failed', () => {
    const runsByWorkflow = new Map([
      [
        'New Workflow',
        [failureRun(2, '2026-06-30T00:00:00Z'), failureRun(1, '2026-06-29T00:00:00Z')],
      ],
    ]);

    // threshold is 5 but only 2 runs exist -- documented behavior: a workflow can only be
    // called chronic once it has accumulated a full window of `threshold` consecutive failures.
    const chronic = detectChronicFailures(runsByWorkflow, 5);

    assert.deepEqual(chronic, []);
  });

  it('reports multiple chronic workflows independently and ignores healthy ones', () => {
    const runsByWorkflow = new Map([
      [
        'Smoke Tests',
        [failureRun(2, '2026-06-30T00:00:00Z'), failureRun(1, '2026-06-29T00:00:00Z')],
      ],
      [
        'CI Success',
        [successRun(4, '2026-06-30T00:00:00Z'), successRun(3, '2026-06-29T00:00:00Z')],
      ],
    ]);

    const chronic = detectChronicFailures(runsByWorkflow, 2);

    assert.equal(chronic.length, 1);
    assert.equal(chronic[0].workflowName, 'Smoke Tests');
  });

  it('accepts a plain object in addition to a Map', () => {
    const chronic = detectChronicFailures(
      {
        'Smoke Tests': [
          failureRun(2, '2026-06-30T00:00:00Z'),
          failureRun(1, '2026-06-29T00:00:00Z'),
        ],
      },
      2
    );

    assert.equal(chronic.length, 1);
    assert.equal(chronic[0].consecutiveFailures, 2);
  });
});

describe('actions-health chronic-failures CLI', () => {
  it('exits 1 with --fail-on-chronic when a workflow is chronic, and reports it in --json', async () => {
    const output = await runChronicCommand(
      [
        'chronic-failures',
        '--repo',
        'balejosg/ClassroomPath',
        '--threshold',
        '5',
        '--fail-on-chronic',
        '--json',
      ],
      {
        ghJson: (commandArgs) => {
          if (
            commandArgs.includes('--event') &&
            commandArgs[commandArgs.indexOf('--event') + 1] === 'schedule'
          ) {
            return [
              failureRun(105, '2026-06-30T00:00:00Z'),
              failureRun(104, '2026-06-29T00:00:00Z'),
              failureRun(103, '2026-06-28T00:00:00Z'),
              failureRun(102, '2026-06-27T00:00:00Z'),
              failureRun(101, '2026-06-26T00:00:00Z'),
            ].map((run) => ({ ...run, workflowName: 'Smoke Tests' }));
          }
          // push events: an unrelated, healthy workflow
          return [
            successRun(201, '2026-06-30T00:00:00Z'),
            successRun(200, '2026-06-29T00:00:00Z'),
          ].map((run) => ({ ...run, workflowName: 'CI Success' }));
        },
      }
    );

    assert.equal(output.status, 1);
    const parsed = JSON.parse(output.stdout);
    assert.equal(parsed.state, 'chronic');
    assert.equal(parsed.chronicWorkflows.length, 1);
    assert.equal(parsed.chronicWorkflows[0].workflowName, 'Smoke Tests');
    assert.equal(parsed.chronicWorkflows[0].consecutiveFailures, 5);
    assert.equal(parsed.chronicWorkflows[0].streakStartRunId, 101);
  });

  it('exits 0 without --fail-on-chronic even when a workflow is chronic', async () => {
    const output = await runChronicCommand(
      ['chronic-failures', '--repo', 'balejosg/ClassroomPath', '--threshold', '5', '--json'],
      {
        ghJson: () =>
          [
            failureRun(105, '2026-06-30T00:00:00Z'),
            failureRun(104, '2026-06-29T00:00:00Z'),
            failureRun(103, '2026-06-28T00:00:00Z'),
            failureRun(102, '2026-06-27T00:00:00Z'),
            failureRun(101, '2026-06-26T00:00:00Z'),
          ].map((run) => ({ ...run, workflowName: 'Smoke Tests' })),
      }
    );

    assert.equal(output.status, 0);
    assert.equal(JSON.parse(output.stdout).state, 'chronic');
  });

  it('exits 0 and reports clean when no workflow is chronic', async () => {
    const output = await runChronicCommand(
      [
        'chronic-failures',
        '--repo',
        'balejosg/ClassroomPath',
        '--threshold',
        '3',
        '--fail-on-chronic',
        '--json',
      ],
      {
        ghJson: () =>
          [successRun(1, '2026-06-30T00:00:00Z'), successRun(2, '2026-06-29T00:00:00Z')].map(
            (run) => ({
              ...run,
              workflowName: 'CI Success',
            })
          ),
      }
    );

    assert.equal(output.status, 0);
    assert.deepEqual(JSON.parse(output.stdout).chronicWorkflows, []);
    assert.equal(JSON.parse(output.stdout).state, 'clean');
  });

  it('degrades gracefully (exit 0) when gh is unavailable, even with --fail-on-chronic', async () => {
    const output = await runChronicCommand(
      ['chronic-failures', '--repo', 'balejosg/ClassroomPath', '--fail-on-chronic', '--json'],
      { execError: new Error('gh unavailable') }
    );

    assert.equal(output.status, 0);
    assert.equal(JSON.parse(output.stdout).state, 'unavailable');
  });
});

async function runChronicCommand(
  args: string[],
  options: {
    ghJson: unknown | ((commandArgs: string[]) => unknown);
    execError?: Error;
  }
) {
  let stdout = '';
  let stderr = '';
  const result = await runActionsHealthCommand(['node', 'scripts/actions-health.mjs', ...args], {
    execFile: async (command: string, commandArgs: string[]) => {
      assert.equal(command, 'gh');
      if (options.execError) {
        throw options.execError;
      }
      const payload =
        typeof options.ghJson === 'function' ? options.ghJson(commandArgs) : options.ghJson;
      return { stdout: `${JSON.stringify(payload)}\n`, stderr: '' };
    },
    stdout: (value: string) => {
      stdout += value;
    },
    stderr: (value: string) => {
      stderr += value;
    },
  });

  return { ...result, stdout, stderr };
}
