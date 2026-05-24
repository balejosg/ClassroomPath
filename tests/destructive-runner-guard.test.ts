import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findBlockingDestructiveRunnerJobs,
  formatBlockingDestructiveRunnerMessage,
} from '../scripts/lib/destructive-runner-guard.mjs';

describe('destructive Windows runner guard', () => {
  test('detects an active destructive Windows job on the same runner label set', () => {
    const blockingJobs = findBlockingDestructiveRunnerJobs({
      currentRunId: '200',
      runs: [
        {
          id: 100,
          name: 'Production Client Update Canary',
          run_number: 42,
          status: 'in_progress',
          html_url: 'https://github.example/runs/100',
        },
      ],
      jobsByRunId: {
        100: [
          {
            name: 'Windows Client Self-Update Canary',
            status: 'in_progress',
            conclusion: null,
            runner_name: '<runner-name>',
            labels: ['self-hosted', 'Windows', 'X64', 'proxmox', 'classroompath'],
          },
        ],
      },
    });

    assert.equal(blockingJobs.length, 1);
    assert.equal(blockingJobs[0]?.jobName, 'Windows Client Self-Update Canary');
    assert.match(
      formatBlockingDestructiveRunnerMessage(blockingJobs),
      /Failing before mutating DNS, browser policy, services, scheduled tasks/
    );
  });

  test('ignores the current run and non-destructive jobs', () => {
    const blockingJobs = findBlockingDestructiveRunnerJobs({
      currentRunId: '100',
      runs: [
        { id: 100, name: 'Windows Production Bootstrap Canary', status: 'in_progress' },
        { id: 101, name: 'Production Client Update Canary', status: 'in_progress' },
      ],
      jobsByRunId: new Map([
        [
          '100',
          [
            {
              name: 'Windows Production Bootstrap Canary',
              status: 'in_progress',
              conclusion: null,
              labels: ['self-hosted', 'Windows', 'classroompath'],
            },
          ],
        ],
        [
          '101',
          [
            {
              name: 'Production Enrollment Download Canary',
              status: 'in_progress',
              conclusion: null,
              labels: ['ubuntu-latest'],
            },
          ],
        ],
      ]),
    });

    assert.deepEqual(blockingJobs, []);
  });
});
