import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        'verify-production-target-ready',
        'release-preflight',
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
    assert.match(
      commandsById['verify-production-target-ready'],
      /npm run verify:production-target-ready/
    );
    assert.match(
      commandsById['release-preflight'],
      /RELEASE_PREFLIGHT_NEXT_TAG=v1\.2\.301 npm run release:preflight/
    );
    assert.match(
      commandsById['tag-production'],
      /bash scripts\/tag-production-release\.sh v1\.2\.301/
    );
    assert.match(commandsById['wait-production-deploy'], /actions-health\.mjs wait/);
    assert.match(commandsById['wait-production-deploy'], /gh run list/);
    assert.match(commandsById['wait-production-deploy'], /--workflow deploy\.yml/);
    assert.match(commandsById['wait-production-deploy'], /--event push/);
    assert.match(commandsById['wait-production-deploy'], /--branch v1\.2\.301/);
    assert.match(
      commandsById['verify-production-health'],
      /deploy-targets\.mjs get production gatewayHealthUrl/
    );
    assert.match(
      commandsById['verify-production-health'],
      /deploy-targets\.mjs get production readyUrl/
    );
    assert.doesNotMatch(
      commandsById['verify-production-health'],
      /classroompath\.example\.invalid/
    );
    assert.match(commandsById['report-residual-actions-runs'], /actions-health\.mjs report-stale/);
    assert.match(commandsById['report-residual-actions-runs'], /--tag v1\.2\.301/);
  });

  it('persists and reuses the exact Release Bundle identity across the RC wait and staging deploy', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.301', highRiskWindows: false });
    const commandsById = Object.fromEntries(
      plan.steps.map((step) => [step.id, formatCommand(step.command)])
    );

    assert.match(commandsById['wait-release-candidate'], /resolve-bundle/u);
    assert.doesNotMatch(commandsById['wait-release-candidate'], /resolve-manifest/u);
    assert.match(commandsById['wait-release-candidate'], /release_bundle_run_id/u);
    assert.match(commandsById['wait-release-candidate'], /RELEASE_ID/u);
    assert.match(commandsById['deploy-staging'], /STAGING_RELEASE_ID/u);
    assert.match(commandsById['deploy-staging'], /STAGING_RELEASE_RUN_ID/u);
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
      'npm run diagnostics:windows-ajax:direct -- --environment production --confirm-production --artifact-dir .opencode/tmp/postproduction-windows-ajax/v1.2.301 --skip-when-canary-token-absent'
    );
  });

  it('run-post-production-windows-canary command includes --skip-when-canary-token-absent', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.301', highRiskWindows: true });
    const canaryStep = plan.steps.find((step) => step.id === 'run-post-production-windows-canary');

    assert.ok(canaryStep, 'run-post-production-windows-canary step should be present');
    assert.ok(
      Array.isArray(canaryStep.command) &&
        canaryStep.command.includes('--skip-when-canary-token-absent'),
      'post-production canary command must include --skip-when-canary-token-absent'
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

  it('verify-clean-repos binds the checked-out OpenPath commit to the gitlink without advancing it', () => {
    const plan = buildPromotionPlan({ tag: 'v1.2.3' });
    const verifyStep = plan.steps.find((step) => step.id === 'verify-clean-repos');
    const command = formatCommand(verifyStep?.command);

    assert.match(command, /git rev-parse HEAD:upstream\/openpath/);
    assert.match(command, /git -C upstream\/openpath rev-parse HEAD/);
    assert.doesNotMatch(command, /ensure-openpath-submodule-on-main\.sh/);
    assert.doesNotMatch(command, /upstream\/openpath.*origin\/main/);
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
        fromStep: null,
        only: [],
        resume: false,
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
        fromStep: null,
        only: [],
        resume: false,
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
      fromStep: null,
      only: [],
      resume: false,
    });

    assert.deepEqual(parseReleasePromoteArgs(['--auto-tag', '--dry-run']), {
      tag: '',
      autoTag: true,
      dryRun: true,
      execute: false,
      highRiskWindows: true,
      postProductionWindowsCanary: true,
      help: false,
      fromStep: null,
      only: [],
      resume: false,
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
    assert.match(stdout, /npm run verify:production-target-ready/);
    assert.match(stdout, /bash scripts\/tag-production-release\.sh v0\.0\.0/);
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
      'verify-production-target-ready',
      'release-preflight',
      'tag-production',
      'wait-production-deploy',
      'verify-production-health',
      'report-residual-actions-runs',
    ]);
  });

  it('refreshes stale Windows prepromotion evidence once and retries promotion readiness', async () => {
    const executedSteps = [];
    let verifyAttempts = 0;

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v0.0.0',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
      ],
      {
        stdout: () => {},
        stderr: () => {},
        runStep: async (step) => {
          executedSteps.push(step.id);
          if (step.id === 'verify-promotion-ready') {
            verifyAttempts += 1;
            return verifyAttempts === 1
              ? {
                  id: step.id,
                  status: 'failed',
                  seconds: 1,
                  stderr: 'windows-prepromotion-evidence-stale for staged SHA',
                }
              : { id: step.id, status: 'success', seconds: 1 };
          }
          return { id: step.id, status: 'success', seconds: 1 };
        },
      }
    );

    assert.equal(result.status, 0);
    assert.equal(verifyAttempts, 2);
    assert.deepEqual(
      executedSteps.filter(
        (id) => id === 'verify-promotion-ready' || id === 'ensure-windows-prepromotion-evidence'
      ),
      ['verify-promotion-ready', 'ensure-windows-prepromotion-evidence', 'verify-promotion-ready']
    );
  });

  it('reruns a retryable failed production deploy once and waits again', async () => {
    const executedSteps = [];
    let waitAttempts = 0;
    const reruns = [];

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v0.0.0',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
      ],
      {
        stdout: () => {},
        stderr: () => {},
        rerunGitHubRunFailedJobs: async (options) => {
          reruns.push(options);
          return { id: 'rerun-production-deploy', status: 'success', seconds: 1 };
        },
        runStep: async (step) => {
          executedSteps.push(step.id);
          if (step.id === 'wait-production-deploy') {
            waitAttempts += 1;
            return waitAttempts === 1
              ? {
                  id: step.id,
                  status: 'failed',
                  seconds: 1,
                  githubRun: {
                    repo: 'balejosg/ClassroomPath',
                    runId: '12345',
                    workflow: 'Deploy',
                    status: 'completed',
                    conclusion: 'failure',
                    failedJobs: [{ name: 'Deploy to Production', conclusion: 'failure' }],
                  },
                  deployBrief: {
                    failureBoundary: { safeToRetry: 'after-cleanup' },
                    nextCommand: 'gh run rerun 12345 --failed --repo balejosg/ClassroomPath',
                  },
                }
              : {
                  id: step.id,
                  status: 'success',
                  seconds: 1,
                  githubRun: {
                    repo: 'balejosg/ClassroomPath',
                    runId: '12345',
                    workflow: 'Deploy',
                    status: 'completed',
                    conclusion: 'success',
                    failedJobs: [],
                  },
                };
          }
          return { id: step.id, status: 'success', seconds: 1 };
        },
      }
    );

    assert.equal(result.status, 0);
    assert.equal(waitAttempts, 2);
    assert.deepEqual(reruns, [{ repo: 'balejosg/ClassroomPath', runId: '12345' }]);
    assert.deepEqual(
      executedSteps.filter((id) => id === 'wait-production-deploy'),
      ['wait-production-deploy', 'wait-production-deploy']
    );
  });

  it('parses actions-health stdout, runs deploy brief, and reruns retryable production deploys', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'release-promote-actions-health-'));
    const executedSteps = [];
    const reruns = [];
    let waitAttempts = 0;

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v0.0.0',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
      ],
      {
        transcriptRoot: outputRoot,
        stdout: () => {},
        stderr: () => {},
        rerunGitHubRunFailedJobs: async (options) => {
          reruns.push(options);
          return { id: 'rerun-production-deploy', status: 'success', seconds: 1 };
        },
        runStep: async (step) => {
          executedSteps.push({ id: step.id, command: formatCommand(step.command) });
          if (step.id === 'wait-production-deploy') {
            waitAttempts += 1;
            return waitAttempts === 1
              ? {
                  id: step.id,
                  status: 'failed',
                  seconds: 1,
                  stdout: [
                    'Found production deploy run: 24680',
                    JSON.stringify({
                      runId: '24680',
                      status: 'completed',
                      conclusion: 'failure',
                      state: 'corrupt',
                      recommendedAction: 'rerun-workflow',
                      url: 'https://github.com/balejosg/ClassroomPath/actions/runs/24680',
                    }),
                    '',
                  ].join('\n'),
                }
              : {
                  id: step.id,
                  status: 'success',
                  seconds: 1,
                  stdout: [
                    'Found production deploy run: 24680',
                    JSON.stringify({
                      runId: '24680',
                      status: 'completed',
                      conclusion: 'success',
                      state: 'healthy',
                      recommendedAction: 'none',
                      url: 'https://github.com/balejosg/ClassroomPath/actions/runs/24680',
                    }),
                    '',
                  ].join('\n'),
                };
          }
          if (step.id === 'build-production-deploy-brief') {
            return {
              id: step.id,
              status: 'success',
              seconds: 1,
              stdout: JSON.stringify({
                failureBoundary: { safeToRetry: 'after-cleanup' },
                nextCommand: 'gh run rerun 24680 --failed --repo balejosg/ClassroomPath',
              }),
            };
          }
          return { id: step.id, status: 'success', seconds: 1 };
        },
      }
    );

    assert.equal(result.status, 0);
    assert.deepEqual(reruns, [{ repo: 'balejosg/ClassroomPath', runId: '24680' }]);
    assert.match(
      executedSteps.find((step) => step.id === 'build-production-deploy-brief').command,
      /npm run ops:deploy-brief -- --run 24680 --tag v0\.0\.0 --output-dir/
    );

    const transcriptJson = JSON.parse(
      readFileSync(join(outputRoot, 'v0.0.0', 'release-promote-transcript.json'), 'utf8')
    );
    const deployWaitSteps = transcriptJson.steps.filter(
      (step) => step.id === 'wait-production-deploy'
    );
    assert.equal(deployWaitSteps[0].runId, '24680');
    assert.equal(deployWaitSteps[1].runId, '24680');
  });

  it('writes execute transcripts under the tag-specific release-promote directory', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'release-promote-transcript-'));

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v0.0.0',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
      ],
      {
        transcriptRoot: outputRoot,
        stdout: () => {},
        stderr: () => {},
        runStep: async (step) => ({
          id: step.id,
          status: 'success',
          seconds: 1,
          githubRun:
            step.id === 'wait-production-deploy'
              ? {
                  repo: 'balejosg/ClassroomPath',
                  runId: '777',
                  url: 'https://github.com/balejosg/ClassroomPath/actions/runs/777',
                  workflow: 'Deploy',
                  status: 'completed',
                  conclusion: 'success',
                  failedJobs: [],
                }
              : undefined,
        }),
      }
    );

    assert.equal(result.status, 0);
    const transcriptJson = JSON.parse(
      readFileSync(join(outputRoot, 'v0.0.0', 'release-promote-transcript.json'), 'utf8')
    );
    const transcriptMarkdown = readFileSync(
      join(outputRoot, 'v0.0.0', 'release-promote-transcript.md'),
      'utf8'
    );

    assert.equal(transcriptJson.tag, 'v0.0.0');
    assert.equal(transcriptJson.status, 'success');
    assert.equal(
      transcriptJson.steps.find((step) => step.id === 'wait-production-deploy').runId,
      '777'
    );
    assert.match(transcriptMarkdown, /# Release Promote Transcript: v0\.0\.0/);
    assert.match(transcriptMarkdown, /\| wait-production-deploy \| success \|/);
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

  it('logs a clear skip message when the post-production canary exits 0 with the skip marker', async () => {
    let stdout = '';

    const result = await runReleasePromoteCommand(
      ['--tag', 'v0.0.0', '--execute', '--no-high-risk-windows'],
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
        runStep: async (step) => ({
          id: step.id,
          status: 'success',
          seconds: 1,
          stdout:
            step.id === 'run-post-production-windows-canary'
              ? 'POST_PRODUCTION_WINDOWS_CANARY_SKIPPED=token-absent\n'
              : '',
          stderr: '',
        }),
      }
    );

    assert.equal(result.status, 0);
    assert.match(
      stdout,
      /run-post-production-windows-canary skipped \(CI-only CP_CLIENT_CANARY_ADMIN_TOKEN absent/
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
