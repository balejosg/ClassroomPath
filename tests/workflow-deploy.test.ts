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
    env?: Record<string, unknown>;
    run?: string;
    with?: Record<string, unknown>;
    shell?: string;
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

function assertOpenPathSubmoduleResetBeforeRecursiveCheckout(
  workflowRelativePath: string,
  jobName: string
): void {
  const workflow = readWorkflow(workflowRelativePath);
  const job = findWorkflowJob(workflow, jobName);
  const steps = job.steps ?? [];
  const resetStepIndex = steps.findIndex(
    (step) => step.name === 'Reset OpenPath submodule checkout'
  );
  const checkoutStepIndex = steps.findIndex((step) => step.name === 'Checkout main');

  assert.ok(resetStepIndex >= 0, `${workflowRelativePath} must reset stale submodule state`);
  assert.ok(checkoutStepIndex >= 0, `${workflowRelativePath} must checkout main`);
  assert.ok(
    resetStepIndex < checkoutStepIndex,
    `${workflowRelativePath} must reset stale submodule state before checkout`
  );

  const resetStep = steps[resetStepIndex];
  const checkoutStep = steps[checkoutStepIndex];
  const resetScript = String(resetStep?.run ?? '');

  assert.equal(resetStep?.shell, 'bash');
  assert.equal(resetStep?.['working-directory'], '${{ runner.temp }}');
  assert.match(resetScript, /GITHUB_WORKSPACE:-/);
  assert.match(resetScript, /""\|"\/"/);
  assert.match(resetScript, /\$GITHUB_WORKSPACE\/upstream\/openpath/);
  assert.match(resetScript, /\$GITHUB_WORKSPACE\/\.git\/modules\/upstream\/openpath/);
  assert.equal(checkoutStep?.uses, 'actions/checkout@v6');
  assert.equal(checkoutStep?.with?.submodules, 'recursive');
}

function assertGitHubCliAvailableBeforeInstallAndResolve(
  workflowRelativePath: string,
  jobName: string,
  resolveStepName: string
): void {
  const workflow = readWorkflow(workflowRelativePath);
  const job = findWorkflowJob(workflow, jobName);
  const steps = job.steps ?? [];
  const setupNodeStepIndex = steps.findIndex((step) => step.name === 'Setup Node.js');
  const ghStepIndex = steps.findIndex((step) => step.name === 'Ensure GitHub CLI');
  const installStepIndex = steps.findIndex((step) => step.name === 'Install dependencies');
  const resolveStepIndex = steps.findIndex((step) => step.name === resolveStepName);

  assert.ok(setupNodeStepIndex >= 0, `${workflowRelativePath} must set up Node.js`);
  assert.ok(ghStepIndex >= 0, `${workflowRelativePath} must ensure GitHub CLI exists`);
  assert.ok(installStepIndex >= 0, `${workflowRelativePath} must install dependencies`);
  assert.ok(resolveStepIndex >= 0, `${workflowRelativePath} must define ${resolveStepName}`);
  assert.ok(
    setupNodeStepIndex < ghStepIndex && ghStepIndex < installStepIndex,
    `${workflowRelativePath} must provision GitHub CLI before dependency install`
  );
  assert.ok(
    ghStepIndex < resolveStepIndex,
    `${workflowRelativePath} must provision GitHub CLI before ${resolveStepName}`
  );

  const ghStep = steps[ghStepIndex];
  const ghScript = String(ghStep?.run ?? '');

  assert.equal(ghStep?.shell, 'bash');
  assert.equal(ghStep?.env?.GH_CLI_VERSION, '2.83.0');
  assert.match(ghScript, /command -v gh/);
  assert.match(ghScript, /gh_\$\{GH_CLI_VERSION\}_linux_\$\{gh_arch\}\.tar\.gz/);
  assert.match(ghScript, /GITHUB_PATH/);
  assert.match(ghScript, /gh --version/);
}

function assertNightlyStagingCandidateGate(
  workflow: WorkflowDefinition,
  workflowText: string
): void {
  const jobs = workflow.jobs ?? {};
  const job = findWorkflowJob(workflow, 'deploy-current-main-to-staging');
  const verifyJob = findWorkflowJob(workflow, 'verify-production-promotion-readiness');
  const workflowDispatchInputs = workflow.on?.workflow_dispatch?.inputs ?? {};
  const prepareSshStep = findWorkflowStepByName(job, 'Prepare SSH keys');
  const deployStep = findWorkflowStepByName(job, 'Deploy staging');
  const promotionReadyStep = findWorkflowStepByName(
    verifyJob,
    'Verify production promotion readiness'
  );
  const verifyGhStep = findWorkflowStepByName(verifyJob, 'Ensure GitHub CLI');
  const persistStep = findWorkflowStepByName(
    findWorkflowJob(workflow, 'persist-windows-staging-bootstrap-canary'),
    'Persist canary evidence to staging release state'
  );

  assert.ok(!('dry_run' in workflowDispatchInputs));
  assert.equal(prepareSshStep.if, undefined);
  assert.equal(deployStep.if, undefined);
  assert.equal(prepareSshStep.shell, 'bash');
  assert.match(String(prepareSshStep.run ?? ''), /STAGING_SSH_KEY=/);
  assert.match(String(prepareSshStep.run ?? ''), /DEPLOY_SSH_KEY=/);
  assert.equal(prepareSshStep.env?.STAGING_SSH_KEY_SECRET, '${{ secrets.STAGING_DEPLOY_SSH_KEY }}');
  assert.equal(prepareSshStep.env?.DEPLOY_SSH_KEY_SECRET, '${{ secrets.DEPLOY_SSH_KEY }}');
  assert.ok(workflowText.includes('scripts/wait-for-release-candidate.mjs resolve-manifest'));
  assert.match(String(deployStep.run ?? ''), /npm run deploy:staging:assume-yes/);
  assert.equal(
    jobs['windows-staging-bootstrap-canary']?.uses,
    './.github/workflows/windows-production-bootstrap-canary.yml'
  );
  assert.equal(jobs['windows-staging-bootstrap-canary']?.with?.target_environment, 'staging');
  assert.match(
    String(jobs['windows-staging-bootstrap-canary']?.with?.base_url ?? ''),
    /needs\.deploy-current-main-to-staging\.outputs\.staging_url/
  );
  assert.equal(jobs['windows-staging-bootstrap-canary']?.with?.diagnostic_mode, 'false');
  assert.match(
    String(findWorkflowStepByName(job, 'Resolve nightly staging outputs')?.run ?? ''),
    /deploy-targets\.mjs get staging publicUrl/
  );
  assert.match(String(persistStep.run ?? ''), /persist-staging-windows-bootstrap-canary\.sh/);
  assert.match(
    String(persistStep.env?.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA ?? ''),
    /needs\.deploy-current-main-to-staging\.outputs\.sha/
  );
  assert.match(String(promotionReadyStep.run ?? ''), /npm run verify:promotion-ready/);
  assert.equal(verifyGhStep.shell, 'bash');
  assert.match(String(verifyGhStep.run ?? ''), /command -v gh/);
  assert.ok(
    String(verifyJob.steps?.map((step) => step.name).join('\n') ?? '').indexOf(
      'Ensure GitHub CLI'
    ) <
      String(verifyJob.steps?.map((step) => step.name).join('\n') ?? '').indexOf(
        'Install dependencies'
      )
  );
  assert.equal(promotionReadyStep.env?.GH_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.equal(promotionReadyStep.env?.GITHUB_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.equal(promotionReadyStep.env?.OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS, 2400);
  assert.equal(promotionReadyStep.env?.OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS, 10);
  assert.match(String(promotionReadyStep.env?.PROMOTION_REPORT_JSON_PATH ?? ''), /runner\.temp/);
  assert.match(String(promotionReadyStep.env?.PROMOTION_EVIDENCE_DIR ?? ''), /runner\.temp/);
  assert.ok(
    workflowText.indexOf('npm run deploy:staging:assume-yes') <
      workflowText.indexOf('windows-production-bootstrap-canary.yml') &&
      workflowText.indexOf('windows-production-bootstrap-canary.yml') <
        workflowText.indexOf('persist-staging-windows-bootstrap-canary.sh') &&
      workflowText.indexOf('persist-staging-windows-bootstrap-canary.sh') <
        workflowText.indexOf('npm run verify:promotion-ready')
  );
  assert.ok(!workflowText.includes('Nightly Staging Candidate Dry Run'));
  assert.ok(!workflowText.includes('State | dry-run'));
  assert.ok(!workflowText.includes('inputs.dry_run'));
}

describe('Deploy workflow contracts', () => {
  test('nightly staging candidate workflow deploys current main without production side effects', () => {
    const workflow = readWorkflow('.github/workflows/nightly-staging-candidate.yml');
    const workflowText = readText('.github/workflows/nightly-staging-candidate.yml');
    const job = findWorkflowJob(workflow, 'deploy-current-main-to-staging');

    assert.ok(workflow.on?.schedule?.[0]?.cron);
    assert.deepEqual(workflow.on?.workflow_dispatch, {});
    assert.deepEqual(job['runs-on'], ['self-hosted', 'Linux', 'X64', 'proxmox', 'classroompath']);
    assert.equal(workflow.permissions?.contents, 'read');
    assert.ok(workflowText.includes('ref: main'));
    assert.ok(workflowText.includes('scripts/wait-for-release-candidate.mjs resolve-manifest'));
    assert.ok(workflowText.includes('npm run deploy:staging:assume-yes'));
    assert.ok(workflowText.includes('npm run verify:promotion-ready'));
    assert.ok(workflowText.includes('release-candidate-images.env'));
    assert.equal(
      workflow.env?.CLASSROOMPATH_STAGING_PUBLIC_URL,
      '${{ vars.CLASSROOMPATH_STAGING_PUBLIC_URL || vars.STAGING_PUBLIC_URL }}',
      'nightly staging deploy must inject public staging URL variables for deploy-targets.mjs'
    );
    assert.equal(
      workflow.env?.CLASSROOMPATH_PRODUCTION_PUBLIC_URL,
      '${{ vars.CLASSROOMPATH_PRODUCTION_PUBLIC_URL || vars.PRODUCTION_PUBLIC_URL }}',
      'nightly promotion readiness must inject public production URL variables for deploy-targets.mjs'
    );
    assert.ok(workflowText.includes('GITHUB_STEP_SUMMARY'));
    assert.ok(!workflowText.includes('git tag'));
    assert.ok(!workflowText.includes('promote:production'));
    assert.ok(!workflowText.includes('deploy:production'));
    assert.ok(!workflowText.includes('deploy-production-remote.sh'));
    assertOpenPathSubmoduleResetBeforeRecursiveCheckout(
      '.github/workflows/nightly-staging-candidate.yml',
      'deploy-current-main-to-staging'
    );
    assertGitHubCliAvailableBeforeInstallAndResolve(
      '.github/workflows/nightly-staging-candidate.yml',
      'deploy-current-main-to-staging',
      'Resolve release-candidate manifest'
    );
    assertNightlyStagingCandidateGate(workflow, workflowText);
  });

  test('manual current staging promotion workflow creates a tag and leaves deploy to deploy.yml', () => {
    const workflow = readWorkflow('.github/workflows/promote-current-staging-candidate.yml');
    const workflowText = readText('.github/workflows/promote-current-staging-candidate.yml');
    const job = findWorkflowJob(workflow, 'tag-current-staging-candidate');

    assert.deepEqual(workflow.on?.workflow_dispatch, {});
    assert.deepEqual(job['runs-on'], ['self-hosted', 'Linux', 'X64', 'proxmox', 'classroompath']);
    assert.equal(workflow.permissions?.contents, 'read');
    assert.ok(workflowText.includes('scripts/promote-current-staging-candidate.sh'));
    assert.ok(workflowText.includes('actions/create-github-app-token@v3'));
    assert.ok(workflowText.includes('permission-workflows: write'));
    assert.ok(workflowText.includes('PROMOTION_TAG_PUSH_TOKEN'));
    assert.ok(workflowText.includes('STAGING_SSH_KEY'));
    assert.ok(workflowText.includes('DEPLOY_SSH_KEY'));
    assert.ok(workflowText.includes('scripts/preflight-current-staging-promotion.sh'));
    assert.ok(!workflowText.includes('docker build'));
    assert.ok(!workflowText.includes('npm run deploy'));
    assert.ok(!workflowText.includes('deploy-production-remote.sh'));
    assertOpenPathSubmoduleResetBeforeRecursiveCheckout(
      '.github/workflows/promote-current-staging-candidate.yml',
      'tag-current-staging-candidate'
    );
    assertGitHubCliAvailableBeforeInstallAndResolve(
      '.github/workflows/promote-current-staging-candidate.yml',
      'tag-current-staging-candidate',
      'Promote current staging candidate'
    );
  });

  test('deploy and smoke workflows reuse shared transport, verifier, and concurrency helpers', () => {
    const deployWorkflow = readWorkflow('.github/workflows/deploy.yml');
    const deployWorkflowText = readText('.github/workflows/deploy.yml');
    const rollbackProductionScript = readText('scripts/rollback-production-remote.sh');
    const verifyStagingJob = findWorkflowJob(deployWorkflow, 'verify-staging-release-state');
    const deployProductionJob = findWorkflowJob(deployWorkflow, 'deploy-production');
    const resolveReleaseImagesJob = findWorkflowJob(deployWorkflow, 'resolve-release-images');
    const smokeWorkflowText = readText('.github/workflows/smoke-tests.yml');
    const smokeWorkflow = readWorkflow('.github/workflows/smoke-tests.yml');
    const reusableSmokeWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');
    const reusableSmokeWorkflow = readWorkflow('.github/workflows/reusable-smoke-test.yml');
    const reusableSmokeJob = findWorkflowJob(reusableSmokeWorkflow, 'smoke');
    const runSmokeInVerifierScript = readText('scripts/run-smoke-in-verifier.sh');
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
    const linuxProductionBootstrapCanaryWorkflow = readWorkflow(
      '.github/workflows/linux-production-bootstrap-canary.yml'
    );
    const concurrency = deployWorkflow.concurrency;
    const jobs = deployWorkflow.jobs ?? {};
    const readProductionReleaseStateStep = findWorkflowStepByName(
      verifyStagingJob,
      'Read production release state'
    );
    const readProductionReleaseStateScript = String(readProductionReleaseStateStep?.run ?? '');

    assert.ok(smokeWorkflowText.includes('./.github/workflows/reusable-smoke-test.yml'));
    assert.ok(smokeWorkflowText.includes('resolve-latest-verifier-image.mjs'));
    assert.ok(smokeWorkflowText.includes('needs.smoke-test-staging.outputs.failure_boundary_id'));
    assert.ok(
      smokeWorkflowText.includes('needs.smoke-test-production.outputs.failure_boundary_id')
    );
    assert.match(smokeWorkflowText, /Staging failureBoundary/);
    assert.match(smokeWorkflowText, /Production failureBoundary/);
    assert.equal(
      smokeWorkflow.on?.workflow_call,
      undefined,
      'top-level smoke workflow should remain manually/schedule triggered'
    );
    assert.ok(reusableSmokeWorkflowText.includes('run-smoke-in-verifier.sh'));
    assert.ok(reusableSmokeWorkflowText.includes('verifier_image:'));
    assert.ok(reusableSmokeWorkflowText.includes('wait-for-ready.sh'));
    assert.ok(!reusableSmokeWorkflowText.includes('npm ci'));
    assert.equal(
      reusableSmokeJob['timeout-minutes'],
      15,
      'reusable smoke job must be bounded so smoke cannot run for roughly an hour without new evidence'
    );
    assert.equal(
      reusableSmokeWorkflow.on?.workflow_call?.outputs?.['failure_boundary_id']?.value,
      '${{ jobs.smoke.outputs.failure_boundary_id }}'
    );
    assert.equal(
      reusableSmokeWorkflow.on?.workflow_call?.outputs?.['failure_boundary_message']?.value,
      '${{ jobs.smoke.outputs.failure_boundary_message }}'
    );
    assert.equal(
      reusableSmokeJob.outputs?.failure_boundary_id,
      '${{ steps.failure-boundary.outputs.failure_boundary_id }}'
    );
    assert.equal(
      reusableSmokeJob.outputs?.failure_boundary_message,
      '${{ steps.failure-boundary.outputs.failure_boundary_message }}'
    );
    assert.match(reusableSmokeWorkflowText, /readiness-timeout/);
    assert.match(reusableSmokeWorkflowText, /smoke-failure-boundary\.json/);
    assert.match(reusableSmokeWorkflowText, /failureBoundary: \\`\$failure_boundary_id\\`/);
    assert.match(reusableSmokeWorkflowText, /steps\.readiness\.outcome != 'success'/);
    assert.match(reusableSmokeWorkflowText, /SMOKE_FAILURE_BOUNDARY_ID/);
    assert.match(reusableSmokeWorkflowText, /SMOKE_FAILURE_BOUNDARY_MESSAGE/);
    assert.match(reusableSmokeWorkflowText, /smoke-results\.txt\n\s+smoke-failure-boundary\.json/);
    assert.match(runSmokeInVerifierScript, /verifier-image-pull/);
    assert.match(runSmokeInVerifierScript, /smoke-test-failed/);
    assert.match(runSmokeInVerifierScript, /PIPESTATUS\[0\]/);
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
    assert.equal(
      deployWorkflow.env?.CLASSROOMPATH_DEPLOY_ROOT,
      "${{ vars.CLASSROOMPATH_DEPLOY_ROOT || '/opt/classroompath' }}"
    );
    assert.equal(
      deployWorkflow.env?.CLASSROOMPATH_PRODUCTION_PUBLIC_URL,
      '${{ vars.CLASSROOMPATH_PRODUCTION_PUBLIC_URL || vars.PRODUCTION_PUBLIC_URL }}',
      'production public URL workflow env must come from public GitHub variables, not SSH host secrets'
    );
    assert.equal(
      deployWorkflow.env?.CLASSROOMPATH_STAGING_PUBLIC_URL,
      '${{ vars.CLASSROOMPATH_STAGING_PUBLIC_URL || vars.STAGING_PUBLIC_URL }}',
      'staging public URL workflow env must come from public GitHub variables, not SSH host secrets'
    );
    assert.doesNotMatch(
      deployWorkflowText,
      /format\('https:\/\/\{0\}[^']*', secrets\.(?:DEPLOY_HOST|STAGING_DEPLOY_HOST)\)/,
      'deploy workflow must not synthesize public HTTPS URLs from SSH host secrets'
    );
    assert.doesNotMatch(
      deployWorkflowText,
      /secrets\.(?:PRODUCTION|STAGING)_(?:PUBLIC|CANARY_PUBLIC|GATEWAY_HEALTH|READY|API_HEALTH|API_CONFIG)_URL/,
      'public deploy target URLs should be GitHub variables or deploy-targets.mjs values, not secrets'
    );
    assert.match(
      readProductionReleaseStateScript,
      /production_release_state_path="\$\{CLASSROOMPATH_DEPLOY_ROOT%\/\}\/release-state\/current-images\.env"/
    );
    assert.match(readProductionReleaseStateScript, /"\$production_release_state_path"/);
    assert.doesNotMatch(
      readProductionReleaseStateScript,
      /\/srv\/classroompath\/release-state\/current-images\.env/,
      'production release-state reads must use CLASSROOMPATH_DEPLOY_ROOT, not the staging root'
    );
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
      verifyStagingJob.outputs?.staging_enrollment_download_result,
      '${{ steps.compare.outputs.staging_enrollment_download_result }}'
    );
    assert.equal(
      verifyStagingJob.outputs?.staging_linux_enrollment_script_result,
      '${{ steps.compare.outputs.staging_linux_enrollment_script_result }}'
    );
    assert.equal(
      verifyStagingJob.outputs?.staging_windows_enrollment_script_result,
      '${{ steps.compare.outputs.staging_windows_enrollment_script_result }}'
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
    assert.deepEqual(
      Object.keys(jobs['resolve-release-images']?.outputs ?? {}).filter((outputName) =>
        /(?:public_url|health_url|ready_url|api_config_url)$/.test(outputName)
      ),
      [],
      'resolve-release-images must not publish cross-job public URL outputs'
    );
    assert.ok(jobs['verify-staging-release-state']);
    assert.ok(jobs['deploy-production']);
    assert.ok(jobs['smoke-test-production']);
    const productionSmokeJob = jobs['smoke-test-production'];
    const waitForProductionReadinessStep = findWorkflowStepByName(
      productionSmokeJob,
      'Wait for production readiness'
    );
    assert.equal(
      productionSmokeJob?.['timeout-minutes'],
      25,
      'production smoke job must not be able to hang the deploy workflow indefinitely'
    );
    assert.match(
      String(waitForProductionReadinessStep?.run ?? ''),
      /\$CLASSROOMPATH_PRODUCTION_READY_URL/,
      'production smoke readiness must use job env directly because GitHub drops secret-looking URL job outputs'
    );
    assert.ok(
      !String(waitForProductionReadinessStep?.env?.PRODUCTION_READY_URL ?? '').includes(
        'needs.resolve-release-images.outputs.production_ready_url'
      ),
      'production smoke readiness must not depend on resolve-release-images URL outputs'
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
    assert.equal(
      productionClientUpdateCanaryWorkflow.on?.workflow_run,
      undefined,
      'production self-update canaries must not rerun automatically after deploy'
    );
    assert.ok(
      String(postReleaseLinuxCanaryJob?.if ?? '').includes(
        "github.event_name == 'workflow_dispatch'"
      ),
      'Linux self-update canary should remain available as an explicit manual diagnostic'
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
      String(step.name ?? '').includes('Download live enrollment scripts')
    );
    const windowsEnrollmentStepIndex =
      productionSmokeJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Download live enrollment scripts')
      ) ?? -1;
    assert.ok(
      windowsEnrollmentStep,
      'production smoke must download live Linux and Windows enrollment scripts'
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /node scripts\/enrollment-download-canary\.mjs/
    );
    assert.equal(
      windowsEnrollmentStep?.env?.ENROLLMENT_CANARY_BASE_URL,
      '${{ env.CLASSROOMPATH_PRODUCTION_PUBLIC_URL }}'
    );
    assert.equal(
      windowsEnrollmentStep?.env?.ENROLLMENT_CANARY_CLASSROOM_ID,
      '${{ steps.provision-enrollment.outputs.classroom_id }}'
    );
    assert.equal(
      windowsEnrollmentStep?.env?.ENROLLMENT_CANARY_TOKEN,
      '${{ steps.provision-enrollment.outputs.enrollment_token }}'
    );
    assert.equal(windowsEnrollmentStep?.env?.ENROLLMENT_CANARY_ENVIRONMENT, 'production');
    assert.equal(
      windowsEnrollmentStep?.env?.ENROLLMENT_CANARY_EXPECTED_LINUX_AGENT_VERSION,
      '${{ needs.resolve-release-images.outputs.openpath_linux_agent_version }}'
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /production-enrollment-download-canary\.json/
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /node scripts\/enrollment-download-canary\.mjs/
    );
    assert.doesNotMatch(String(windowsEnrollmentStep?.run ?? ''), /grep/);
    assert.doesNotMatch(
      String(windowsEnrollmentStep?.run ?? ''),
      /OpenPath Enrollment \(Windows\)/,
      'production smoke must not depend on non-functional Windows enrollment banner text'
    );
    assert.ok(!deployWorkflowText.includes('OpenPath Enrollment (Windows)'));
    const runProductionSmokeStepIndex =
      productionSmokeJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Run smoke tests against production')
      ) ?? -1;
    const provisionEnrollmentStep = findWorkflowStepByName(
      productionSmokeJob,
      'Provision production enrollment smoke canary'
    );
    const runProductionSmokeStep = findWorkflowStepByName(
      productionSmokeJob,
      'Run smoke tests against production'
    );
    assert.equal(
      provisionEnrollmentStep?.env?.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL,
      '${{ env.CLASSROOMPATH_PRODUCTION_PUBLIC_URL }}'
    );
    assert.equal(
      runProductionSmokeStep?.env?.SMOKE_TEST_URL,
      '${{ env.CLASSROOMPATH_PRODUCTION_PUBLIC_URL }}'
    );
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
    assert.ok(jobs['windows-staging-bootstrap-canary']);
    assert.equal(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml'
    );
    assert.equal(
      jobs['windows-staging-bootstrap-canary']?.uses,
      './.github/workflows/windows-production-bootstrap-canary.yml'
    );
    assert.equal(jobs['windows-staging-bootstrap-canary']?.with?.target_environment, 'staging');
    assert.match(
      String(jobs['windows-staging-bootstrap-canary']?.with?.base_url ?? ''),
      /env\.CLASSROOMPATH_STAGING_CANARY_PUBLIC_URL/
    );
    assert.equal(jobs['windows-staging-bootstrap-canary']?.with?.diagnostic_mode, 'false');
    assert.ok(
      !('continue-on-error' in jobs['windows-firefox-canary']),
      'reusable workflow jobs cannot use continue-on-error in the caller'
    );
    assert.equal(
      canaryReusableJob.outputs?.canary_result,
      '${{ steps.result.outputs.canary_result }}'
    );
    const windowsProductionBootstrapCanaryJob = findWorkflowJob(
      windowsProductionBootstrapCanaryWorkflow,
      'windows-production-bootstrap-canary'
    );
    assert.equal(
      findWorkflowStepByName(
        windowsProductionBootstrapCanaryJob,
        'Upload production bootstrap canary artifacts'
      )?.with?.name,
      'windows-production-bootstrap-canary'
    );
    assert.equal(
      findWorkflowStepByName(
        windowsProductionBootstrapCanaryJob,
        'Upload preproduction bootstrap canary artifacts'
      )?.with?.name,
      'preproduction-windows-bootstrap-canary'
    );
    assert.match(
      String(
        findWorkflowStepByName(
          windowsProductionBootstrapCanaryJob,
          'Upload preproduction bootstrap canary artifacts'
        )?.if ?? ''
      ),
      /TARGET_ENVIRONMENT != 'production'/
    );
    assert.match(
      String(
        findWorkflowStepByName(windowsProductionBootstrapCanaryJob, 'Record canary result')?.env
          ?.PREPRODUCTION_ARTIFACT_UPLOAD_OUTCOME ?? ''
      ),
      /TARGET_ENVIRONMENT == 'production'.*'success'/
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
      /"STAGING_ENROLLMENT_DOWNLOAD_RESULT": "\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_enrollment_download_result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT": "\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_linux_enrollment_script_result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT": "\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_windows_enrollment_script_result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_RESULT": "\$\{\{ needs\.windows-staging-bootstrap-canary\.outputs\.canary_result \|\| needs\.windows-staging-bootstrap-canary\.result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_JOB_RESULT": "\$\{\{ needs\.windows-staging-bootstrap-canary\.result \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /"PREPRODUCTION_WINDOWS_BOOTSTRAP_FAILURE_BOUNDARY_ID": "\$\{\{ needs\.windows-staging-bootstrap-canary\.outputs\.failure_boundary_id \|\| 'preproduction-windows-bootstrap-canary' \}\}"/
    );
    assert.match(
      deployWorkflowText,
      /Windows staging bootstrap canary did not produce a failure boundary/
    );
    assert.match(
      deployWorkflowText,
      /"LINUX_PRODUCTION_BOOTSTRAP_CANARY_RESULT": "not_run_preproduction_authoritative"/
    );
    assert.match(deployWorkflowText, /"LINUX_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT": "skipped"/);
    assert.match(
      deployWorkflowText,
      /"LINUX_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID": "preproduction-installed-client-evidence"/
    );
    assert.match(
      deployWorkflowText,
      /Functional installed-client evidence is gated before production promotion/
    );
    assert.match(
      String(
        findWorkflowStepByName(jobs['release-evidence'], 'Generate release evidence')?.run ?? ''
      ),
      /cat release-evidence\.md >> "\$GITHUB_STEP_SUMMARY"/,
      'release evidence markdown, including the compact canary boundary summary, must be appended to the job summary'
    );
    assert.ok(deployWorkflowText.includes('Generate release evidence bundle'));
    assert.ok(deployWorkflowText.includes('Record release evidence bundle follow-up command'));
    assert.ok(deployWorkflowText.includes('Generate deploy brief'));
    assert.match(
      deployWorkflowText,
      /npm run ops:deploy-brief -- \\\n+\s+--release-evidence "\$release_evidence_path" \\\n+\s+--output-dir deploy-brief/
    );
    assert.match(
      deployWorkflowText,
      /cat deploy-brief\/deploy-brief\.md >> "\$GITHUB_STEP_SUMMARY"/
    );
    assert.ok(deployWorkflowText.includes('Generate release timing summary'));
    assert.ok(deployWorkflowText.includes('scripts/run-github-run-timing-summary.mjs'));
    assert.match(
      deployWorkflowText,
      /"RUN_TIMING_SUMMARY_PATH": "release-timing-summary\/run-timing-summary\.json"/
    );
    assert.match(
      deployWorkflowText,
      /node scripts\/release-evidence-bundle\.mjs \\\n+\s+--deploy-run "\$\{\{ github\.run_id \}\}" \\\n+\s+--tag "\$\{\{ github\.ref_name \}\}" \\\n+\s+--production-url "\$\{\{ steps\.production-target\.outputs\.public_url \}\}" \\\n+\s+--output-dir release-evidence-bundle/
    );
    const uploadReleaseEvidenceStep = findWorkflowStepByName(
      jobs['release-evidence'],
      'Upload release evidence'
    );
    assert.equal(uploadReleaseEvidenceStep?.with?.['if-no-files-found'], 'ignore');
    assert.match(
      String(uploadReleaseEvidenceStep?.with?.path ?? ''),
      /release-evidence-bundle\/\*\*/,
      'release evidence upload should preserve the full best-effort bundle when present'
    );
    assert.match(
      String(uploadReleaseEvidenceStep?.with?.path ?? ''),
      /release-timing-summary\/\*\*/,
      'release evidence upload should preserve the automatic run timing summary'
    );
    assert.match(
      String(uploadReleaseEvidenceStep?.with?.path ?? ''),
      /deploy-brief\/\*\*/,
      'release evidence upload should preserve the compact deploy brief'
    );
    const failDeployBriefStep = findWorkflowStepByName(
      jobs['release-evidence'],
      'Fail release evidence on deploy brief failure'
    );
    assert.match(
      String(failDeployBriefStep?.run ?? ''),
      /deploy-brief\/deploy-brief\.json/,
      'release evidence must inspect the generated deploy brief status'
    );
    assert.match(
      String(failDeployBriefStep?.run ?? ''),
      /Deploy brief status is not releasable/,
      'release evidence must fail the workflow when the deploy brief status is fail'
    );
    assert.ok(!jobs['production-client-update-canary']);
    assert.equal(
      jobs['windows-production-bootstrap-canary'],
      undefined,
      'production deploy must not repeat full Windows installed-client bootstrap canaries after deploy'
    );
    assert.equal(
      jobs['linux-production-bootstrap-canary'],
      undefined,
      'production deploy must not repeat full Linux installed-client bootstrap canaries after deploy'
    );
    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    const releaseEvidenceNeeds = normalizeNeeds(jobs['release-evidence']?.needs);
    assert.ok(deployNeeds.includes('resolve-release-images'));
    assert.ok(deployNeeds.includes('verify-staging-release-state'));
    assert.ok(!deployNeeds.includes('windows-firefox-canary'));
    assert.ok(deployNeeds.includes('windows-staging-bootstrap-canary'));
    assert.ok(releaseEvidenceNeeds.includes('windows-firefox-canary'));
    assert.ok(releaseEvidenceNeeds.includes('windows-staging-bootstrap-canary'));
    assert.ok(!releaseEvidenceNeeds.includes('windows-production-bootstrap-canary'));
    assert.ok(!releaseEvidenceNeeds.includes('linux-production-bootstrap-canary'));
    assert.match(String(jobs['deploy-production']?.if ?? ''), /^always\(\) && /);
    assert.doesNotMatch(String(jobs['deploy-production']?.if ?? ''), /windows-firefox-canary/);
    assert.match(
      String(jobs['deploy-production']?.if ?? ''),
      /needs\.verify-staging-release-state\.outputs\.staging_windows_firefox_high_risk != 'true' \|\| needs\.windows-staging-bootstrap-canary\.result == 'success'/
    );
    assert.ok(
      !normalizeNeeds(jobs['rollback-production']?.needs).includes(
        'windows-production-bootstrap-canary'
      ),
      'rollback should only observe deploy and production smoke failures on the release path'
    );
    assert.ok(
      !normalizeNeeds(jobs['rollback-production']?.needs).includes(
        'linux-production-bootstrap-canary'
      ),
      'rollback should not wait on full Linux installed-client canaries after production deploy'
    );
    assert.doesNotMatch(
      String(jobs['rollback-production']?.if ?? ''),
      /production-bootstrap-canary/
    );
    assert.ok(windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs);
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.outputs?.failure_boundary_id
        ?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.failure_boundary_id }}'
    );
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.outputs?.failure_boundary_message
        ?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.failure_boundary_message }}'
    );
    assert.equal(
      linuxProductionBootstrapCanaryWorkflow.on?.workflow_call?.outputs?.failure_boundary_id?.value,
      '${{ jobs.linux-production-bootstrap-canary.outputs.failure_boundary_id }}'
    );
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs?.target_environment
        ?.required,
      true
    );
    assert.equal(
      windowsProductionBootstrapCanaryWorkflow.on?.workflow_call?.inputs?.base_url?.required,
      true
    );
    assert.match(
      String(
        findWorkflowStepByName(windowsProductionBootstrapCanaryJob, 'Resolve target host')?.run ??
          ''
      ),
      /STAGING_DEPLOY_/,
      'manual bootstrap diagnostics should be able to resolve staging SSH/secrets without changing the production deploy caller'
    );
    const linuxProductionBootstrapCanaryJob = findWorkflowJob(
      linuxProductionBootstrapCanaryWorkflow,
      'linux-production-bootstrap-canary'
    );
    assert.match(
      String(
        findWorkflowStepByName(linuxProductionBootstrapCanaryJob, 'Resolve canary inputs')?.run ??
          ''
      ),
      /node scripts\/deploy-targets\.mjs get "\$target_environment" publicUrl/,
      'Linux bootstrap canary must derive the public URL from the target environment when the caller passes an empty base_url'
    );
    assert.match(
      String(
        findWorkflowStepByName(
          linuxProductionBootstrapCanaryJob,
          'Verify Linux AJAX auto-allow canary'
        )?.env?.LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL ?? ''
      ),
      /steps\.inputs\.outputs\.base_url/,
      'Linux AJAX verification must use the resolved canary base_url, not the raw workflow input'
    );
    assert.match(
      String(
        findWorkflowStepByName(
          linuxProductionBootstrapCanaryJob,
          'Download live linux/install-openpath.sh enrollment script'
        )?.run ?? ''
      ),
      /\$PRODUCTION_BASE_URL\/api\/enroll\/\$CLASSROOM_ID"/,
      'Linux bootstrap canary must download the canonical Linux enrollment script URL'
    );
    assert.doesNotMatch(
      String(
        findWorkflowStepByName(
          linuxProductionBootstrapCanaryJob,
          'Download live linux/install-openpath.sh enrollment script'
        )?.run ?? ''
      ),
      /\/linux\/install-openpath\.sh/,
      'Linux bootstrap canary must not use a non-existent nested linux/install-openpath.sh route'
    );
    assert.match(
      String(
        findWorkflowStepByName(linuxProductionBootstrapCanaryJob, 'Resolve target host')?.run ?? ''
      ),
      /github_actions_remote_install_ssh_key/,
      'Linux bootstrap canary must resolve the remote target before reading production runtime env'
    );
    assert.match(
      String(
        findWorkflowStepByName(
          linuxProductionBootstrapCanaryJob,
          'Read target client canary admin token'
        )?.run ?? ''
      ),
      /github_actions_remote_read_env_key/,
      'Linux bootstrap canary must read CP_CLIENT_CANARY_ADMIN_TOKEN from the target runtime env'
    );
    assert.match(
      deployWorkflowText,
      /CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA:\s+\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_email_delivery_high_risk == 'true' && '0' \|\| '1' \}\}/
    );
    assert.match(
      deployWorkflowText,
      /CP_EMAIL_PREFLIGHT_MODE:\s+\$\{\{ needs\.verify-staging-release-state\.outputs\.staging_email_delivery_high_risk == 'true' && 'required' \|\| 'skip' \}\}/
    );
    assert.match(deployWorkflowText, /envs: .*CLASSROOMPATH_DEPLOY_ROOT/);
    assert.match(deployWorkflowText, /envs: .*CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA/);
    assert.match(deployWorkflowText, /envs: .*CP_EMAIL_PREFLIGHT_MODE/);
    const downloadDeployDebugStep = findWorkflowStepByName(
      jobs['deploy-production'],
      'Download deploy debug artifact'
    );
    const uploadDeployDebugStep = findWorkflowStepByName(
      jobs['deploy-production'],
      'Upload deploy debug artifact'
    );
    assert.equal(downloadDeployDebugStep?.if, 'failure()');
    assert.equal(uploadDeployDebugStep?.if, 'failure()');
    assert.equal(downloadDeployDebugStep?.['continue-on-error'], true);
    assert.equal(uploadDeployDebugStep?.['continue-on-error'], true);
    assert.match(
      String(downloadDeployDebugStep?.run ?? ''),
      /\$\{CLASSROOMPATH_DEPLOY_ROOT%\/\}\/release-state\/deploy-debug\.json/,
      'production deploy failure should fetch the sanitized deploy-debug.json from the configured deploy root'
    );
    assert.equal(
      uploadDeployDebugStep?.with?.name,
      'production-deploy-debug-${{ github.ref_name }}'
    );
    assert.equal(uploadDeployDebugStep?.with?.['if-no-files-found'], 'ignore');
    assert.equal(uploadDeployDebugStep?.with?.path, 'deploy-debug.json');
    assert.ok(!deployNeeds.includes('release-gate-staging'));
  });
});
