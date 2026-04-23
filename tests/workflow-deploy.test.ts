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
    const rollbackProductionScript = readText('scripts/rollback-production-remote.sh');
    const verifyStagingJob = findWorkflowJob(deployWorkflow, 'verify-staging-release-state');
    const deployProductionJob = findWorkflowJob(deployWorkflow, 'deploy-production');
    const resolveReleaseImagesJob = findWorkflowJob(deployWorkflow, 'resolve-release-images');
    const smokeWorkflowText = readText('.github/workflows/smoke-tests.yml');
    const reusableSmokeWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');
    const cleanupWorkflow = readText('.github/workflows/cleanup-staging.yml');
    const canaryWorkflow = readText('.github/workflows/windows-firefox-canary.yml');
    const canaryReusableWorkflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const canaryReusableJob = findWorkflowJob(canaryReusableWorkflow, 'windows-firefox-canary');
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
    assert.ok(deployWorkflowText.includes('Resolve OpenPath required-check base'));
    assert.ok(deployWorkflowText.includes('OPENPATH_BASE_SHA'));
    assert.ok(!deployWorkflowText.includes('OPENPATH_REQUIRED_CHECKS: CI Success'));
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
    const productionSmokeJob = jobs['smoke-test-production'];
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production billing mode')?.run ?? ''
      ).includes('github_actions_remote_read_env_key'),
      'production smoke should read the live billing mode from production before provisioning canaries'
    );
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production client canary admin token')
          ?.run ?? ''
      ).includes('CP_CLIENT_CANARY_ADMIN_TOKEN'),
      'manual-only production smoke should read the canary admin token from production'
    );
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production Stripe webhook secret')?.run ??
          ''
      ).includes('STRIPE_WEBHOOK_SECRET'),
      'stripe production smoke should read the webhook secret from production'
    );
    const enrollmentStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download live Linux enrollment script')
    );
    assert.ok(enrollmentStep, 'production smoke must download a live Linux enrollment script');
    assert.match(String(enrollmentStep?.run ?? ''), /\/api\/enroll\/\$CLASSROOM_ID/);
    assert.match(String(enrollmentStep?.run ?? ''), /Authorization: Bearer \$ENROLLMENT_TOKEN/);
    assert.match(String(enrollmentStep?.run ?? ''), /OPENPATH_LINUX_AGENT_VERSION/);
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /head -n 1 "\$enroll_script" \| grep -Eq '\^#!.*bash'/
    );
    const windowsEnrollmentStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download live Windows enrollment script')
    );
    assert.ok(
      windowsEnrollmentStep,
      'production smoke must download a live Windows enrollment script'
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /\/api\/enroll\/\$CLASSROOM_ID\/windows\.ps1/
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /Authorization: Bearer \$ENROLLMENT_TOKEN/
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /api\/agent\/windows\/bootstrap\/manifest/
    );
    assert.match(String(windowsEnrollmentStep?.run ?? ''), /\$env:OPENPATH_VERSION/);
    assert.ok(jobs['rollback-production']);
    assert.ok(
      normalizeNeeds(jobs['rollback-production']?.needs).includes('resolve-release-images'),
      'rollback must receive the resolved production container platform'
    );
    assert.ok(
      String(
        jobs['rollback-production']?.steps?.find((step) => step.name === 'Roll back via SSH')?.with
          ?.envs ?? ''
      ).includes('PRODUCTION_CONTAINER_PLATFORM'),
      'rollback SSH step must forward PRODUCTION_CONTAINER_PLATFORM'
    );
    assert.ok(
      rollbackProductionScript.includes('deploy-container-platform.sh') &&
        rollbackProductionScript.includes(
          'configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/arm64}"'
        ) &&
        rollbackProductionScript.includes('verify_deploy_container_platform'),
      'rollback must force the production container platform before docker compose pull/up'
    );
    assert.ok(jobs['release-evidence']);
    assert.ok(jobs['windows-firefox-canary']);
    assert.equal(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml'
    );
    assert.ok(
      !('continue-on-error' in jobs['windows-firefox-canary']),
      'reusable workflow jobs cannot use continue-on-error in the caller'
    );
    assert.equal(
      canaryReusableJob.outputs?.canary_result,
      '${{ steps.result.outputs.canary_result }}'
    );
    assert.equal(
      findWorkflowStepByName(
        canaryReusableJob,
        'Download staging Firefox release evidence and assets'
      )?.['continue-on-error'],
      true
    );
    assert.equal(
      findWorkflowStepByName(canaryReusableJob, 'Run Firefox policy canary')?.['continue-on-error'],
      true
    );
    assert.match(
      deployWorkflowText,
      /"WINDOWS_FIREFOX_CANARY_RESULT": "\$\{\{ needs\.windows-firefox-canary\.outputs\.canary_result \|\| needs\.windows-firefox-canary\.result \}\}"/
    );
    assert.ok(!jobs['production-client-update-canary']);
    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(deployNeeds.includes('resolve-release-images'));
    assert.ok(deployNeeds.includes('verify-staging-release-state'));
    assert.ok(deployNeeds.includes('windows-firefox-canary'));
    assert.match(String(jobs['deploy-production']?.if ?? ''), /^always\(\) && /);
    assert.match(
      String(jobs['deploy-production']?.if ?? ''),
      /needs\.windows-firefox-canary\.result == 'success' \|\| needs\.windows-firefox-canary\.result == 'skipped'/
    );
    assert.ok(!deployNeeds.includes('release-gate-staging'));
  });
});
