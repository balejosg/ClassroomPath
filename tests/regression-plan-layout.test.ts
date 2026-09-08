import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveRegressionPlan } from '../scripts/lib/regression-plan.mjs';

describe('regression plan layout', () => {
  test('CI and release automation retain the release operations acceptance suites', () => {
    const required = [
      'tests/production-readiness.test.ts',
      'tests/release-candidate-resolution.test.ts',
      'tests/release-promote-rc-first.test.ts',
      'tests/release-promote-resume.test.ts',
      'tests/release-orchestration.test.ts',
      'tests/release-preflight.test.ts',
      'tests/release-status.test.ts',
      'tests/candidate-tooling-provenance.test.ts',
      'tests/deployment-ledger.test.ts',
      'tests/deploy-runtime-executor.test.ts',
      'tests/deploy-runtime-boundary-guards.test.ts',
      'tests/production-durable-state-workflow.test.ts',
      'tests/production-runtime-projection.test.ts',
      'tests/staging-runtime-projection.test.ts',
      'tests/production-recovery-authority.test.ts',
      'tests/check-scripts-typecheck.test.ts',
    ];
    for (const plan of ['ci', 'release-automation']) {
      const files = resolveRegressionPlan(plan);
      for (const file of required) assert.ok(files.includes(file), `${plan} omits ${file}`);
    }
  });

  test('ci and workflow regression plans target sharded ops suites instead of monoliths', () => {
    const ciPlan = resolveRegressionPlan('ci');
    const workflowPlan = resolveRegressionPlan('workflow-config');
    const releaseAutomationPlan = resolveRegressionPlan('release-automation');

    assert.ok(
      ciPlan.includes('tests/docs-verification.test.ts') &&
        ciPlan.includes('tests/deployment-foundation.test.ts') &&
        ciPlan.includes('tests/deployment-staging-release.test.ts') &&
        ciPlan.includes('tests/deployment-runtime-contracts.test.ts'),
      'CI regression should target the sharded deployment suites'
    );
    assert.ok(
      workflowPlan.includes('tests/workflow-core.test.ts') &&
        workflowPlan.includes('tests/workflow-deploy.test.ts') &&
        workflowPlan.includes('tests/workflow-production-client-canary.test.ts') &&
        workflowPlan.includes('tests/workflow-release-candidate.test.ts'),
      'workflow-config regression should target the sharded workflow suites'
    );
    assert.ok(
      !ciPlan.includes('tests/deployment.test.ts') &&
        !workflowPlan.includes('tests/workflow-config.test.ts'),
      'regression plans should stop targeting the old monolithic wrapper suites directly'
    );
    assert.ok(
      releaseAutomationPlan.includes('tests/workflow-core.test.ts') &&
        releaseAutomationPlan.includes('tests/workflow-deploy.test.ts') &&
        releaseAutomationPlan.includes('tests/workflow-production-client-canary.test.ts') &&
        releaseAutomationPlan.includes('tests/workflow-release-candidate.test.ts') &&
        releaseAutomationPlan.includes('tests/verification-pipeline.test.ts'),
      'release automation regression should compose the sharded workflow suites with the release verification suites'
    );
  });
});
