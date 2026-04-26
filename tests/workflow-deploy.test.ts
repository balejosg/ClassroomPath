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
    const productionClientUpdateCanaryWorkflow = readWorkflow(
      '.github/workflows/production-client-update-canary.yml'
    );
    const windowsProductionBootstrapCanaryWorkflowText = readText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const windowsProductionBootstrapCanaryWorkflow = readWorkflow(
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
    const canarySteps = canaryReusableJob?.steps ?? [];
    const canaryPreCheckoutDnsStepIndex = canarySteps.findIndex(
      (step) => step.name === 'Restore Windows runner DNS before checkout'
    );
    const canaryCheckoutStepIndex = canarySteps.findIndex((step) => step.name === 'Checkout');
    const canaryPreCheckoutDnsStep =
      canaryPreCheckoutDnsStepIndex >= 0 ? canarySteps[canaryPreCheckoutDnsStepIndex] : undefined;
    assert.ok(
      canaryPreCheckoutDnsStepIndex >= 0 &&
        canaryCheckoutStepIndex >= 0 &&
        canaryPreCheckoutDnsStepIndex < canaryCheckoutStepIndex,
      'Windows Firefox canary must restore DNS before checkout on the persistent Windows runner'
    );
    assert.equal(canaryPreCheckoutDnsStep?.shell, 'pwsh');
    assert.match(String(canaryPreCheckoutDnsStep?.run ?? ''), /Set-DnsClientServerAddress/);
    assert.match(String(canaryPreCheckoutDnsStep?.run ?? ''), /Clear-DnsClientCache/);
    assert.match(
      String(canaryPreCheckoutDnsStep?.run ?? ''),
      /Test-NetConnection github\.com -Port 443/
    );
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
    assert.ok(deployWorkflowText.includes('detect-email-delivery-risk.sh'));
    assert.equal(
      verifyStagingJob.outputs?.staging_email_delivery_high_risk,
      '${{ steps.email-risk.outputs.high_risk }}'
    );
    assert.equal(
      String(
        findWorkflowStepByName(verifyStagingJob, 'Compare staging release state')?.env?.[
          'EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE'
        ]
      ),
      '${{ needs.resolve-release-images.outputs.openpath_firefox_assets_image }}',
      'production promotion must compare the staged OpenPath Firefox assets image'
    );
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
    assert.equal((concurrency as { group?: string }).group, 'production-deploy-v4');
    assert.equal((concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'], false);
    assert.ok(jobs['resolve-release-images']);
    assert.ok((jobs['resolve-release-images']?.outputs ?? {})['payload_base64']);
    assert.ok(jobs['verify-staging-release-state']);
    assert.ok(jobs['deploy-production']);
    assert.ok(jobs['smoke-test-production']);
    const productionSmokeJob = jobs['smoke-test-production'];
    assert.equal(
      productionSmokeJob?.['timeout-minutes'],
      25,
      'production smoke job must not be able to hang the deploy workflow indefinitely'
    );
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
    const linuxEnrollmentStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download and run live Linux enrollment script')
    );
    const linuxFirefoxCanaryStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Verify production Linux Firefox blocked page canary'
    );
    const installLinuxFirefoxDependenciesStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Install Linux Firefox canary dependencies'
    );
    const restoreLinuxRunnerStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Restore Linux runner')
    );

    assert.equal(
      linuxEnrollmentStep,
      undefined,
      'deploy workflow must not mutate the GitHub-hosted runner by installing the Linux client'
    );
    assert.equal(
      linuxFirefoxCanaryStep,
      undefined,
      'deploy workflow must not run the Linux Firefox canary after mutating runner DNS/firewall'
    );
    assert.equal(
      installLinuxFirefoxDependenciesStep,
      undefined,
      'deploy workflow should leave Linux Firefox runtime checks to the post-release canary workflow'
    );
    assert.equal(
      restoreLinuxRunnerStep,
      undefined,
      'deploy workflow should not need runner DNS cleanup when it avoids Linux client installation'
    );

    const productionClientCanaryJobs = productionClientUpdateCanaryWorkflow.jobs ?? {};
    const postReleaseLinuxCanaryJob = productionClientCanaryJobs['linux-client-self-update-canary'];
    assert.ok(productionClientUpdateCanaryWorkflow.on?.workflow_run?.workflows?.includes('Deploy'));
    assert.ok(
      String(postReleaseLinuxCanaryJob?.if ?? '').includes(
        "github.event.workflow_run.conclusion == 'success'"
      ),
      'post-release Linux canary should run only after a completed successful Deploy workflow'
    );
    assert.ok(
      postReleaseLinuxCanaryJob?.steps?.some((step) =>
        String(step.name ?? '').includes('Download and run live Linux enrollment script')
      ),
      'post-release canary must retain the live Linux enrollment coverage'
    );
    assert.ok(
      postReleaseLinuxCanaryJob?.steps?.some(
        (step) => step.name === 'Verify Linux Firefox blocked page canary'
      ),
      'post-release canary must retain Linux Firefox blocked-page coverage'
    );

    const windowsEnrollmentStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download live Windows enrollment script')
    );
    const windowsEnrollmentStepIndex =
      productionSmokeJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Download live Windows enrollment script')
      ) ?? -1;
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
    const runProductionSmokeStepIndex =
      productionSmokeJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Run smoke tests against production')
      ) ?? -1;
    assert.ok(
      windowsEnrollmentStepIndex >= 0 && windowsEnrollmentStepIndex < runProductionSmokeStepIndex,
      'production smoke should verify the live Windows script before the general app smoke'
    );
    const uploadSmokeResultsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Upload smoke test results'
    );
    assert.equal(
      uploadSmokeResultsStep?.['continue-on-error'],
      true,
      'production smoke artifact upload must not keep a failed canary job stuck'
    );
    assert.ok(String(uploadSmokeResultsStep?.with?.path ?? '').includes('smoke-results.txt'));
    assert.ok(
      !String(uploadSmokeResultsStep?.with?.path ?? '').includes('production-linux'),
      'deploy smoke artifacts should not reference post-release Linux canary artifacts'
    );
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
    assert.match(
      deployWorkflowText,
      /"WINDOWS_STAGING_BOOTSTRAP_CANARY_RESULT": "\$\{\{ needs\.windows-staging-bootstrap-canary\.outputs\.canary_result \|\| needs\.windows-staging-bootstrap-canary\.result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT": "\$\{\{ needs\.windows-production-bootstrap-canary\.outputs\.canary_result \|\| needs\.windows-production-bootstrap-canary\.result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT": "\$\{\{ needs\.windows-production-bootstrap-canary\.result \}\}"/
    );
    assert.ok(!jobs['production-client-update-canary']);
    assert.equal(
      jobs['windows-staging-bootstrap-canary']?.uses,
      './.github/workflows/windows-production-bootstrap-canary.yml'
    );
    assert.equal(jobs['windows-staging-bootstrap-canary']?.with?.target_environment, 'staging');
    assert.equal(
      jobs['windows-staging-bootstrap-canary']?.with?.base_url,
      '${{ needs.resolve-release-images.outputs.staging_public_url }}'
    );
    assert.match(
      String(jobs['windows-staging-bootstrap-canary']?.if ?? ''),
      /staging_windows_firefox_high_risk == 'true'/
    );
    assert.equal(
      jobs['windows-production-bootstrap-canary']?.uses,
      './.github/workflows/windows-production-bootstrap-canary.yml'
    );
    assert.equal(
      jobs['windows-production-bootstrap-canary']?.with?.target_environment,
      'production'
    );
    assert.equal(
      jobs['windows-production-bootstrap-canary']?.with?.base_url,
      '${{ needs.resolve-release-images.outputs.production_public_url }}'
    );
    assert.match(
      String(jobs['windows-production-bootstrap-canary']?.if ?? ''),
      /staging_windows_firefox_high_risk == 'true'/
    );
    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    const productionBootstrapNeeds = normalizeNeeds(
      jobs['windows-production-bootstrap-canary']?.needs
    );
    const releaseEvidenceNeeds = normalizeNeeds(jobs['release-evidence']?.needs);
    assert.ok(deployNeeds.includes('resolve-release-images'));
    assert.ok(deployNeeds.includes('verify-staging-release-state'));
    assert.ok(deployNeeds.includes('windows-firefox-canary'));
    assert.ok(
      deployNeeds.includes('windows-staging-bootstrap-canary'),
      'production deploy must wait for the live Windows AJAX auto-allow canary on staging'
    );
    assert.ok(productionBootstrapNeeds.includes('verify-staging-release-state'));
    assert.ok(productionBootstrapNeeds.includes('deploy-production'));
    assert.ok(releaseEvidenceNeeds.includes('windows-staging-bootstrap-canary'));
    assert.ok(releaseEvidenceNeeds.includes('windows-production-bootstrap-canary'));
    assert.match(String(jobs['deploy-production']?.if ?? ''), /^always\(\) && /);
    assert.match(
      String(jobs['deploy-production']?.if ?? ''),
      /needs\.windows-firefox-canary\.result == 'success' \|\| needs\.windows-firefox-canary\.result == 'skipped'/
    );
    assert.match(
      String(jobs['deploy-production']?.if ?? ''),
      /needs\.windows-staging-bootstrap-canary\.result == 'success' \|\| needs\.windows-staging-bootstrap-canary\.result == 'skipped'/
    );
    assert.ok(
      normalizeNeeds(jobs['rollback-production']?.needs).includes(
        'windows-production-bootstrap-canary'
      ),
      'rollback must observe post-deploy production bootstrap canary failures'
    );
    assert.match(
      String(jobs['rollback-production']?.if ?? ''),
      /needs\.windows-production-bootstrap-canary\.result == 'failure'/
    );
    assert.ok(windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs);
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs?.target_environment
        ?.required,
      true
    );
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs?.base_url?.required,
      true
    );
    const windowsProductionBootstrapCanaryJob = findWorkflowJob(
      windowsProductionBootstrapCanaryWorkflow,
      'windows-production-bootstrap-canary'
    );
    assert.ok(
      String(
        findWorkflowStepByName(windowsProductionBootstrapCanaryJob, 'Read production billing mode')
          ?.run ?? ''
      ).includes('if [ "$TARGET_ENVIRONMENT" = "staging" ]; then'),
      'staging bootstrap canary must not SSH to the staging host to read billing mode'
    );
    assert.ok(
      String(
        findWorkflowStepByName(
          windowsProductionBootstrapCanaryJob,
          'Read production client canary admin token'
        )?.run ?? ''
      ).includes('client_canary_admin_token="${CP_CLIENT_CANARY_ADMIN_TOKEN:-}"'),
      'staging bootstrap canary should read its manual approval token from inherited secrets'
    );
    assert.match(
      deployWorkflowText,
      /CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA:\s+\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_email_delivery_high_risk == 'true' && '0' \|\| '1' \}\}/
    );
    assert.match(
      deployWorkflowText,
      /CP_EMAIL_PREFLIGHT_MODE:\s+\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_email_delivery_high_risk == 'true' && 'required' \|\| 'skip' \}\}/
    );
    assert.match(deployWorkflowText, /envs: .*CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA/);
    assert.match(deployWorkflowText, /envs: .*CP_EMAIL_PREFLIGHT_MODE/);
    assert.ok(!deployNeeds.includes('release-gate-staging'));
  });
});
