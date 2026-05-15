import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPromotionPlan,
  formatCommand,
  runStep,
} from '../scripts/lib/release-orchestration.mjs';
import { parseReleasePromoteArgs, runReleasePromoteCommand } from '../scripts/release-promote.mjs';

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
    assert.match(commandsById['verify-production-health'], /\/cp\/health/);
    assert.match(commandsById['verify-production-health'], /\/cp\/ready/);
  });

  it('supports an optional post-production Windows canary step before summary', () => {
    const plan = buildPromotionPlan({
      tag: 'v1.2.301',
      highRiskWindows: true,
      postProductionWindowsCanary: true,
    });

    assert.equal(plan.steps.at(-2)?.id, 'run-post-production-windows-canary');
    assert.equal(plan.steps.at(-1)?.id, 'print-summary');
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
        dryRun: true,
        highRiskWindows: true,
        postProductionWindowsCanary: true,
        help: false,
      }
    );
  });

  it('prints the dry-run plan without executing steps', async () => {
    let stdout = '';
    let executed = false;

    const result = await runReleasePromoteCommand(['--tag', 'v0.0.0', '--dry-run'], {
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
});
