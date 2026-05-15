import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runActionsHealthCommand } from '../scripts/actions-health.mjs';
import { classifyWorkflowRunHealth } from '../scripts/lib/github-actions-health.mjs';

describe('classifyWorkflowRunHealth', () => {
  it('classifies queued job with startedAt as corrupt queued state', () => {
    const result = classifyWorkflowRunHealth({
      status: 'completed',
      conclusion: 'failure',
      jobs: [
        { name: 'CI Success', status: 'queued', conclusion: '', startedAt: '2026-05-15T07:45:01Z' },
      ],
    });

    assert.equal(result.state, 'corrupt');
    assert.equal(result.recommendedAction, 'rerun-workflow');
    assert.equal(result.cancelable, false);
    assert.deepEqual(result.jobs, ['CI Success']);
  });

  it('classifies long-running in-progress job as wait when below threshold', () => {
    const result = classifyWorkflowRunHealth({
      status: 'in_progress',
      conclusion: '',
      nowMs: Date.parse('2026-05-15T08:30:00Z'),
      staleAfterMs: 60 * 60 * 1000,
      jobs: [
        {
          name: 'Windows Student Policy',
          status: 'in_progress',
          startedAt: '2026-05-15T08:25:00Z',
        },
      ],
    });

    assert.equal(result.state, 'running');
    assert.equal(result.recommendedAction, 'wait');
    assert.equal(result.cancelable, true);
  });

  it('classifies in-progress jobs beyond threshold as stale', () => {
    const result = classifyWorkflowRunHealth({
      status: 'in_progress',
      conclusion: '',
      nowMs: Date.parse('2026-05-15T09:30:00Z'),
      staleAfterMs: 60 * 60 * 1000,
      jobs: [
        {
          name: 'Windows Student Policy',
          status: 'in_progress',
          startedAt: '2026-05-15T08:25:00Z',
        },
      ],
    });

    assert.equal(result.state, 'stale');
    assert.equal(result.recommendedAction, 'inspect-runner-logs');
    assert.equal(result.cancelable, true);
    assert.deepEqual(result.jobs, ['Windows Student Policy']);
  });

  it('classifies queued workflow as queued and cancelable', () => {
    const result = classifyWorkflowRunHealth({
      status: 'queued',
      conclusion: '',
      jobs: [{ name: 'Build', status: 'queued', startedAt: '' }],
    });

    assert.equal(result.state, 'queued');
    assert.equal(result.recommendedAction, 'wait');
    assert.equal(result.cancelable, true);
  });

  it('classifies completed success and failure as terminal states', () => {
    const success = classifyWorkflowRunHealth({
      status: 'completed',
      conclusion: 'success',
      jobs: [],
    });
    const failure = classifyWorkflowRunHealth({
      status: 'completed',
      conclusion: 'failure',
      jobs: [],
    });

    assert.equal(success.state, 'healthy');
    assert.equal(success.recommendedAction, 'none');
    assert.equal(success.cancelable, false);
    assert.equal(failure.state, 'failed');
    assert.equal(failure.recommendedAction, 'inspect-failed-logs');
    assert.equal(failure.cancelable, false);
  });
});

describe('actions-health CLI', () => {
  it('prints stable JSON for classify', async () => {
    const ghCalls: string[][] = [];
    const output = await runCommand(
      ['classify', '--repo', 'balejosg/ClassroomPath', '--run-id', '123', '--json'],
      {
        ghJson: {
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-15T08:00:00Z',
          url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
          jobs: [
            {
              name: 'deploy',
              status: 'completed',
              conclusion: 'success',
              startedAt: '2026-05-15T07:55:00Z',
            },
          ],
        },
        ghCalls,
      }
    );

    assert.deepEqual(ghCalls, [
      [
        'run',
        'view',
        '123',
        '--repo',
        'balejosg/ClassroomPath',
        '--json',
        'status,conclusion,jobs,updatedAt,url',
      ],
    ]);
    assert.equal(output.status, 0);
    assert.deepEqual(JSON.parse(output.stdout), {
      repo: 'balejosg/ClassroomPath',
      runId: '123',
      status: 'completed',
      conclusion: 'success',
      updatedAt: '2026-05-15T08:00:00Z',
      url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
      state: 'healthy',
      recommendedAction: 'none',
      reason: 'workflow completed successfully',
      jobs: [],
      cancelable: false,
    });
  });

  it('prints human output for classify', async () => {
    const output = await runCommand(
      ['classify', '--repo', 'balejosg/ClassroomPath', '--run-id', '123'],
      {
        ghJson: {
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-15T08:00:00Z',
          url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
          jobs: [],
        },
      }
    );

    assert.equal(output.status, 1);
    assert.match(output.stdout, /GitHub Actions run 123 \(balejosg\/ClassroomPath\)/);
    assert.match(output.stdout, /state: failed/);
    assert.match(output.stdout, /recommended_action: inspect-failed-logs/);
    assert.match(
      output.stdout,
      /url: https:\/\/github.com\/balejosg\/ClassroomPath\/actions\/runs\/123/
    );
  });

  it('wait command polls until a terminal healthy state', async () => {
    const payloads = [
      {
        status: 'in_progress',
        conclusion: '',
        updatedAt: '2026-05-15T08:00:00Z',
        url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
        jobs: [{ name: 'deploy', status: 'in_progress', startedAt: '2026-05-15T07:59:00Z' }],
      },
      {
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-15T08:01:00Z',
        url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
        jobs: [
          {
            name: 'deploy',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-05-15T07:59:00Z',
          },
        ],
      },
    ];

    const output = await runCommand(
      [
        'wait',
        '--repo',
        'balejosg/ClassroomPath',
        '--run-id',
        '123',
        '--timeout-seconds',
        '60',
        '--interval-seconds',
        '1',
        '--json',
      ],
      {
        ghJson: () => payloads.shift(),
        sleep: async () => {},
        nowMs: () => Date.parse('2026-05-15T08:00:00Z'),
      }
    );

    assert.equal(output.status, 0);
    assert.equal(JSON.parse(output.stdout).state, 'healthy');
  });
});

async function runCommand(
  args: string[],
  options: {
    ghJson: unknown | (() => unknown);
    ghCalls?: string[][];
    sleep?: (ms: number) => Promise<void>;
    nowMs?: () => number;
  }
) {
  let stdout = '';
  let stderr = '';
  const result = await runActionsHealthCommand(['node', 'scripts/actions-health.mjs', ...args], {
    execFile: async (command: string, commandArgs: string[]) => {
      assert.equal(command, 'gh');
      options.ghCalls?.push(commandArgs);
      const payload = typeof options.ghJson === 'function' ? options.ghJson() : options.ghJson;
      return { stdout: `${JSON.stringify(payload)}\n`, stderr: '' };
    },
    stdout: (value: string) => {
      stdout += value;
    },
    stderr: (value: string) => {
      stderr += value;
    },
    sleep: options.sleep,
    nowMs: options.nowMs,
  });

  return { ...result, stdout, stderr };
}
