import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findWorkflowJob,
  findWorkflowStepByName,
  readProjectText,
  readProjectWorkflow,
  type WorkflowDefinition,
} from './helpers/ops-contracts.ts';

type WorkflowJob = {
  needs?: string | string[];
  uses?: string;
  outputs?: Record<string, string>;
  steps?: Array<{
    name?: string;
    if?: string;
    run?: string;
    with?: Record<string, unknown>;
  }>;
};

function readWorkflow(relativePath: string): WorkflowDefinition {
  return readProjectWorkflow(relativePath);
}

function readText(relativePath: string): string {
  return readProjectText(relativePath);
}

function normalizeNeeds(needs: WorkflowJob['needs']): string[] {
  if (!needs) {
    return [];
  }

  return Array.isArray(needs) ? needs : [needs];
}

describe('Deploy workflow contracts', () => {
  test('deploy and smoke workflows reuse shared transport, verifier, and concurrency helpers', () => {
    const deployWorkflow = readWorkflow('.github/workflows/deploy.yml');
    const deployWorkflowText = readText('.github/workflows/deploy.yml');
    const verifyStagingJob = findWorkflowJob(deployWorkflow, 'verify-staging-release-state');
    const deployProductionJob = findWorkflowJob(deployWorkflow, 'deploy-production');
    const resolveReleaseImagesJob = findWorkflowJob(deployWorkflow, 'resolve-release-images');
    const smokeWorkflowText = readText('.github/workflows/smoke-tests.yml');
    const reusableSmokeWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');
    const cleanupWorkflow = readText('.github/workflows/cleanup-staging.yml');
    const canaryWorkflow = readText('.github/workflows/windows-firefox-canary.yml');
    const productionClientUpdateCanaryWorkflowText = readText(
      '.github/workflows/production-client-update-canary.yml'
    );
    const windowsProductionBootstrapCanaryWorkflowText = readText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const concurrency = deployWorkflow.concurrency;
    const jobs = deployWorkflow.jobs ?? {};

    assert.ok(smokeWorkflowText.includes('./.github/workflows/reusable-smoke-test.yml'));
    assert.ok(smokeWorkflowText.includes('resolve-latest-verifier-image.mjs'));
    assert.ok(reusableSmokeWorkflowText.includes('run-smoke-in-verifier.sh'));
    assert.ok(reusableSmokeWorkflowText.includes('verifier_image:'));
    assert.ok(reusableSmokeWorkflowText.includes('wait-for-ready.sh'));
    assert.ok(!reusableSmokeWorkflowText.includes('npm ci'));
    assert.ok(deployWorkflowText.includes('source scripts/lib/github-actions-remote.sh'));
    assert.ok(
      String(findWorkflowStepByName(verifyStagingJob, 'Resolve staging host').run ?? '').includes(
        'github_actions_remote_write_resolved_host_outputs'
      )
    );
    assert.ok(
      String(findWorkflowStepByName(deployProductionJob, 'Resolve deploy host').run ?? '').includes(
        'github_actions_remote_write_resolved_host_outputs'
      )
    );
    assert.ok(canaryWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(cleanupWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(
      productionClientUpdateCanaryWorkflowText.includes(
        'source scripts/lib/github-actions-remote.sh'
      )
    );
    assert.ok(
      windowsProductionBootstrapCanaryWorkflowText.includes(
        'source scripts/lib/github-actions-remote.sh'
      )
    );
    assert.ok(!deployWorkflowText.includes('DEPLOY_HOST not configured. Skipping deployment.'));
    assert.ok(deployWorkflowText.includes('verify-staging-release-state.sh'));
    assert.ok(deployWorkflowText.includes('Extract staging evidence from production tag'));
    assert.ok(deployWorkflowText.includes('promotion-evidence-cli.mjs extract-tag-message'));
    assert.ok(
      String(
        findWorkflowStepByName(verifyStagingJob, 'Read staging release state')?.if ?? ''
      ).includes("steps.tag-evidence.outputs.source != 'tag'")
    );
    assert.ok(
      String(
        findWorkflowStepByName(verifyStagingJob, 'Read staging verification evidence')?.if ?? ''
      ).includes("steps.tag-evidence.outputs.source != 'tag'")
    );
    assert.ok(deployWorkflowText.includes('detect-windows-firefox-risk.sh'));
    assert.ok(deployWorkflowText.includes('staging-promotion-eligibility.json'));
    assert.ok(deployWorkflowText.includes('PROMOTION_ELIGIBLE'));
    assert.ok(deployWorkflowText.includes('Verify production release image platforms'));
    assert.ok(deployWorkflowText.includes('verify-release-manifest-platforms.mjs verify'));
    assert.ok(
      String(
        findWorkflowStepByName(resolveReleaseImagesJob, 'Verify production release image platforms')
          ?.run ?? ''
      ).includes('--target-platform "$PRODUCTION_CONTAINER_PLATFORM"')
    );
    assert.equal(typeof concurrency, 'object');
    assert.match((concurrency as { group?: string }).group ?? '', /production/i);
    assert.equal((concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'], false);
    assert.ok(jobs['resolve-release-images']);
    assert.ok((jobs['resolve-release-images']?.outputs ?? {})['payload_base64']);
    assert.ok(jobs['verify-staging-release-state']);
    assert.ok(jobs['deploy-production']);
    assert.ok(jobs['smoke-test-production']);
    assert.ok(jobs['rollback-production']);
    assert.ok(jobs['release-evidence']);
    assert.ok(jobs['windows-firefox-canary']);
    assert.equal(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml'
    );
    assert.ok(!jobs['production-client-update-canary']);
    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(deployNeeds.includes('resolve-release-images'));
    assert.ok(deployNeeds.includes('verify-staging-release-state'));
    assert.ok(!deployNeeds.includes('release-gate-staging'));
  });
});
