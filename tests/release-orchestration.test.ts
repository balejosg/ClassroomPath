import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPromotionPlan,
  buildWaitForTagDeployCommand,
  formatCommand,
  monitorGitHubRun,
  runStep,
  summarizeGitHubRunMonitor,
} from '../scripts/lib/release-orchestration.mjs';
import {
  parseReleasePromoteArgs,
  resolveNextPatchTag,
  runReleasePromoteCommand,
} from '../scripts/release-promote.mjs';

describe('release promotion orchestration', () => {
  it('plans the required step order for high-risk Windows changes', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.301', highRiskWindows: true });

    assert.deepEqual(
      plan.steps.map((step) => step.id),
      [
        'verify-clean-repos',
        'resolve-origin-main',
        'wait-release-candidate',
        'deploy-staging',
        'ensure-windows-prepromotion-evidence',
        'verify-promotion-ready',
        'tag-production',
        'wait-production-deploy',
        'verify-production-health',
        'run-post-production-windows-canary',
        'report-residual-actions-runs',
        'print-summary',
      ]
    );
  });

  it('omits Windows prepromotion evidence when the release is not high risk', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.301', highRiskWindows: false });

    assert.equal(
      plan.steps.some((step) => step.id === 'ensure-windows-prepromotion-evidence'),
      false
    );
  });

  it('composes the production deploy and health commands', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.301', highRiskWindows: true });
    const commandsById = Object.fromEntries(
      plan.steps.map((step) => [step.id, formatCommand(step.command)])
    );

    assert.match(commandsById['deploy-staging'], /npm run deploy:staging/);
    assert.match(commandsById['ensure-windows-prepromotion-evidence'], /run-and-persist/);
    assert.match(commandsById['verify-promotion-ready'], /npm run verify:promotion-ready/);
    assert.match(commandsById['tag-production'], /npm run promote:production -- v1\.2\.301/);
    assert.match(commandsById['wait-production-deploy'], /actions-health\.mjs wait/);
    assert.match(commandsById['wait-production-deploy'], /gh run list/);
    assert.match(commandsById['wait-production-deploy'], /--workflow deploy\.yml/);
    assert.match(commandsById['wait-production-deploy'], /--event push/);
    assert.match(commandsById['wait-production-deploy'], /--branch v1\.2\.301/);
    assert.match(commandsById['verify-production-health'], /\/cp\/health/);
    assert.match(commandsById['verify-production-health'], /\/cp\/ready/);
    assert.match(commandsById['report-residual-actions-runs'], /actions-health\.mjs report-stale/);
    assert.match(commandsById['report-residual-actions-runs'], /--tag v1\.2\.301/);
  });

  it('runs the post-production Windows canary by default before residual reporting', () => {
    const plan = buildPromotionPlan({
      tag: 'v1.2.301',
      highRiskWindows: true,
    });

    const commandsById = Object.fromEntries(
      plan.steps.map((step) => [step.id, formatCommand(step.command)])
    );

    assert.equal(plan.steps.at(-3)?.id, 'run-post-production-windows-canary');
    assert.equal(plan.steps.at(-2)?.id, 'report-residual-actions-runs');
    assert.equal(plan.steps.at(-1)?.id, 'print-summary');
    assert.equal(
      commandsById['run-post-production-windows-canary'],
      'npm run diagnostics:windows-ajax:direct -- --environment production --confirm-production --artifact-dir .opencode/tmp/postproduction-windows-ajax/v1.2.301'
    );
  });

  it('omits the post-production Windows canary when explicitly disabled', () => {
    const plan = buildPromotionPlan({
      tag: 'v1.2.301',
      highRiskWindows: true,
      postProductionWindowsCanary: false,
    });

    assert.equal(
      plan.steps.some((step) => step.id === 'run-post-production-windows-canary'),
      false
    );
    assert.equal(plan.steps.at(-2)?.id, 'report-residual-actions-runs');
    assert.equal(plan.steps.at(-1)?.id, 'print-summary');
  });

  it('builds a polling command for the tag-triggered deploy run', () => {
    const command = formatCommand(buildWaitForTagDeployCommand('v1.2.301'));

    assert.match(command, /deadline=\$\(\(SECONDS \+ 600\)\)/);
    assert.match(command, /gh run list/);
    assert.match(command, /--workflow deploy\.yml/);
    assert.match(command, /--event push/);
    assert.match(command, /--branch v1\.2\.301/);
    assert.match(command, /headBranch == "v1\.2\.301"/);
    assert.match(command, /event == "push"/);
    assert.match(command, /workflowName == "Deploy"/);
    assert.match(command, /actions-health\.mjs wait --repo balejosg\/ClassroomPath --run-id/);
  });

  it('parses release-promote CLI options', () => {
    assert.deepEqual(
      parseReleasePromoteArgs([
        '--tag',
        'v1.2.301',
        '--dry-run',
        '--high-risk-windows',
        '--post-production-windows-canary',
      ]),
      {
        tag: 'v1.2.301',
        autoTag: false,
        dryRun: true,
        execute: false,
        highRiskWindows: true,
        postProductionWindowsCanary: true,
        help: false,
      }
    );

    assert.deepEqual(
      parseReleasePromoteArgs([
        '--tag',
        'v1.2.301',
        '--dry-run',
        '--no-post-production-windows-canary',
      ]),
      {
        tag: 'v1.2.301',
        autoTag: false,
        dryRun: true,
        execute: false,
        highRiskWindows: true,
        postProductionWindowsCanary: false,
        help: false,
      }
    );

    assert.deepEqual(parseReleasePromoteArgs(['--tag', 'v1.2.301', '--execute']), {
      tag: 'v1.2.301',
      autoTag: false,
      dryRun: false,
      execute: true,
      highRiskWindows: true,
      postProductionWindowsCanary: true,
      help: false,
    });

    assert.deepEqual(parseReleasePromoteArgs(['--auto-tag', '--dry-run']), {
      tag: '',
      autoTag: true,
      dryRun: true,
      execute: false,
      highRiskWindows: true,
      postProductionWindowsCanary: true,
      help: false,
    });
  });

  it('resolves --auto-tag from remote tags and keeps dry-run non-mutating', async () => {
    let stdout = '';
    let executed = false;

    const result = await runReleasePromoteCommand(['--auto-tag', '--dry-run'], {
      stdout: (value) => {
        stdout += value;
      },
      stderr: () => {},
      execFile: async (file, args) => {
        assert.equal(file, 'git');
        assert.deepEqual(args, ['ls-remote', '--tags', '--refs', 'origin', 'v*']);
        return {
          stdout: [
            'aaa\trefs/tags/v1.2.299',
            'bbb\trefs/tags/v1.2.301',
            'ccc\trefs/tags/not-semver',
            '',
          ].join('\n'),
        };
      },
      runStep: async () => {
        executed = true;
        return { id: 'unexpected', status: 'success', seconds: 0 };
      },
    });

    assert.equal(result.status, 0);
    assert.equal(executed, false);
    assert.match(stdout, /Production promotion plan for v1\.2\.302/);
  });

  it('increments the highest semantic remote patch tag', async () => {
    const tag = await resolveNextPatchTag({
      execFile: async () => ({
        stdout: [
          'aaa\trefs/tags/v1.9.9',
          'bbb\trefs/tags/v2.0.0',
          'ccc\trefs/tags/v1.10.4',
          '',
        ].join('\n'),
      }),
    });

    assert.equal(tag, 'v2.0.1');
  });

  it('defaults to dry-run and does not execute steps', async () => {
    let stdout = '';
    let executed = false;

    const result = await runReleasePromoteCommand(['--tag', 'v0.0.0'], {
      stdout: (value) => {
        stdout += value;
      },
      stderr: () => {},
      runStep: async () => {
        executed = true;
        return { id: 'unexpected', status: 'success', seconds: 0 };
      },
    });

    assert.equal(result.status, 0);
    assert.equal(executed, false);
    assert.match(stdout, /Production promotion plan for v0\.0\.0/);
    assert.match(stdout, /1\. verify-clean-repos/);
    assert.match(stdout, /ensure-windows-prepromotion-evidence/);
    assert.match(stdout, /npm run deploy:staging/);
    assert.match(stdout, /npm run promote:production -- v0\.0\.0/);
    assert.match(stdout, /run-post-production-windows-canary/);
    assert.match(stdout, /actions-health\.mjs report-stale/);
  });

  it('executes the plan only when --execute is explicit', async () => {
    const executedSteps = [];

    const result = await runReleasePromoteCommand(
      ['--tag', 'v0.0.0', '--execute', '--no-post-production-windows-canary'],
      {
        stdout: () => {},
        stderr: () => {},
        runStep: async (step) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 0 };
        },
      }
    );

    assert.equal(result.status, 0);
    assert.deepEqual(executedSteps, [
      'verify-clean-repos',
      'resolve-origin-main',
      'wait-release-candidate',
      'deploy-staging',
      'ensure-windows-prepromotion-evidence',
      'verify-promotion-ready',
      'tag-production',
      'wait-production-deploy',
      'verify-production-health',
      'report-residual-actions-runs',
    ]);
  });

  it('omits the post-production canary command in dry-run mode only with opt-out', async () => {
    let stdout = '';

    const result = await runReleasePromoteCommand(
      ['--tag', 'v0.0.0', '--dry-run', '--no-post-production-windows-canary'],
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
        runStep: async () => {
          throw new Error('dry-run must not execute steps');
        },
      }
    );

    assert.equal(result.status, 0);
    assert.doesNotMatch(
      stdout,
      /npm run diagnostics:windows-ajax:direct -- --environment production --confirm-production --artifact-dir \.opencode\/tmp\/postproduction-windows-ajax\/v0\.0\.0/
    );
  });

  it('rejects missing tag before building a plan', async () => {
    let stderr = '';
    const result = await runReleasePromoteCommand(['--dry-run'], {
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
      },
    });

    assert.equal(result.status, 2);
    assert.match(stderr, /--tag is required/);
  });

  it('runs a step and reports status with elapsed seconds', async () => {
    const result = await runStep({
      id: 'sample',
      command: [process.execPath, '-e', 'process.exit(0)'],
    });

    assert.equal(result.id, 'sample');
    assert.equal(result.status, 'success');
    assert.equal(typeof result.seconds, 'number');
  });

  it('summarizes GitHub Actions run status and failed jobs without watch noise', async () => {
    const summary = await monitorGitHubRun({
      repo: 'balejosg/ClassroomPath',
      runId: '123',
      execFile: async (file, args) => {
        assert.equal(file, 'gh');
        assert.deepEqual(args.slice(0, 4), ['run', 'view', '123', '--repo']);
        return {
          stdout: JSON.stringify({
            workflowName: 'Deploy',
            status: 'completed',
            conclusion: 'failure',
            url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
            jobs: [
              { name: 'Deploy to Production', status: 'completed', conclusion: 'success' },
              { name: 'Release Evidence', status: 'completed', conclusion: 'failure' },
            ],
          }),
        };
      },
    });

    assert.equal(summary.status, 'completed');
    assert.equal(summary.conclusion, 'failure');
    assert.deepEqual(summary.failedJobs, [
      { name: 'Release Evidence', status: 'completed', conclusion: 'failure' },
    ]);
    assert.equal(
      summarizeGitHubRunMonitor(summary),
      'GitHub Actions run 123: Deploy status=completed conclusion=failure failed_jobs=Release Evidence:failure https://github.com/balejosg/ClassroomPath/actions/runs/123'
    );
  });
});
