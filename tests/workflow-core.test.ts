import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertTextExcludesAll,
  assertTextIncludesAll,
  findWorkflowJob,
  findWorkflowStepByName,
  readProjectJson,
  readProjectText,
  readProjectWorkflow,
  type WorkflowDefinition,
} from './helpers/ops-contracts.ts';

type PackageDefinition = {
  scripts?: Record<string, string>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

function readWorkflow(relativePath: string): WorkflowDefinition {
  return readProjectWorkflow(relativePath);
}

function readText(relativePath: string): string {
  return readProjectText(relativePath);
}

function readPackageJson(): PackageDefinition {
  return readProjectJson<PackageDefinition>('package.json');
}

function assertNpmCiJobsUseSharedNodeSetup(relativePath: string) {
  const workflow = readWorkflow(relativePath);

  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const steps = job.steps ?? [];
    const npmCiIndexes = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => String(step.run ?? '').includes('npm ci'));

    for (const { step, index } of npmCiIndexes) {
      const setupStep = steps
        .slice(0, index)
        .find((candidate) => candidate.uses === './.github/actions/setup-node');

      assert.ok(
        setupStep,
        `${relativePath} job ${jobName} must run shared setup-node before ${step.name ?? 'npm ci'}`
      );
    }

    const installsRoot = npmCiIndexes.some(
      ({ step }) => !step['working-directory'] && step.run === 'npm ci'
    );
    const installsOpenPath = npmCiIndexes.some(
      ({ step }) => step['working-directory'] === 'upstream/openpath' && step.run === 'npm ci'
    );

    if (installsRoot && installsOpenPath) {
      const setupStep = steps.find((step) => step.uses === './.github/actions/setup-node');
      assert.match(
        String(setupStep?.with?.['cache-dependency-path'] ?? ''),
        /package-lock\.json[\s\S]*upstream\/openpath\/package-lock\.json/,
        `${relativePath} job ${jobName} must cache both root and OpenPath npm lockfiles`
      );
    }
  }
}

describe('Workflow core contracts', () => {
  test('GitHub Actions workflows pin current action majors and shared setup actions', () => {
    const cases = [
      {
        relativePath: '.github/workflows/ci.yml',
        required: ['actions/checkout@v6', './.github/actions/setup-node'],
        forbidden: ['actions/checkout@v4', 'actions/setup-node@v4'],
      },
      {
        relativePath: '.github/workflows/sync-openpath.yml',
        required: [
          'actions/checkout@v6',
          './.github/actions/setup-node',
          'persist-credentials: false',
        ],
        forbidden: ['actions/checkout@v4', 'actions/setup-node@v4'],
      },
      {
        relativePath: '.github/actions/setup-node/action.yml',
        required: ['actions/setup-node@v6'],
        forbidden: ['actions/setup-node@v4'],
      },
      {
        relativePath: '.github/workflows/verify-trailers.yml',
        required: ['actions/checkout@v6'],
        forbidden: ['actions/checkout@v4'],
      },
      {
        relativePath: '.github/workflows/deploy.yml',
        required: ['docker/login-action@v4', './.github/actions/setup-node'],
        forbidden: ['docker/login-action@v3'],
      },
    ];

    for (const { relativePath, required, forbidden } of cases) {
      const content = readProjectText(relativePath);
      assertTextIncludesAll(content, required, `${relativePath} should include required versions`);
      assertTextExcludesAll(
        content,
        forbidden,
        `${relativePath} should exclude forbidden versions`
      );
    }
  });

  test('self-hosted Linux runner smoke workflow is manual and pinned to the ClassroomPath runner', () => {
    const workflowText = readText('.github/workflows/self-hosted-linux-runner-smoke.yml');
    const workflow = readWorkflow('.github/workflows/self-hosted-linux-runner-smoke.yml');
    const smokeJob = workflow.jobs?.smoke;

    assert.ok(
      workflow.on?.workflow_dispatch,
      'self-hosted runner smoke must expose only manual dispatch'
    );
    assert.ok(
      !workflow.on?.push && !workflow.on?.workflow_run,
      'self-hosted runner smoke must not run on automatic repository events'
    );
    assert.deepEqual(smokeJob?.['runs-on'], [
      'self-hosted',
      'Linux',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(
      workflowText.includes('classroompath-linux-102'),
      'self-hosted runner smoke should verify the expected ClassroomPath runner name'
    );
    assert.ok(
      workflowText.includes('actions/checkout@v6') &&
        workflowText.includes('persist-credentials: false'),
      'self-hosted runner smoke should use checkout without persisted credentials'
    );
  });

  test('self-hosted Windows runner smoke workflow is manual and pinned to the ClassroomPath runner', () => {
    const workflowText = readText('.github/workflows/self-hosted-windows-runner-smoke.yml');
    const workflow = readWorkflow('.github/workflows/self-hosted-windows-runner-smoke.yml');
    const inspectJob = workflow.jobs?.['inspect-runner-registration'];
    const smokeJob = workflow.jobs?.smoke;

    assert.ok(
      workflow.on?.workflow_dispatch,
      'self-hosted Windows runner smoke must expose manual dispatch'
    );
    assert.equal(
      workflow.on?.schedule?.[0]?.cron,
      '*/30 * * * *',
      'self-hosted Windows runner smoke must run as a watchdog every 30 minutes'
    );
    assert.ok(
      !workflow.on?.push && !workflow.on?.workflow_run,
      'self-hosted Windows runner smoke must not run on push or deploy events'
    );
    assert.equal(inspectJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(
      workflowText.includes('gh api repos/${{ github.repository }}/actions/runners') &&
        workflowText.includes('classroompath-windows-103'),
      'watchdog must inspect runner registration before queueing self-hosted work'
    );
    assert.deepEqual(smokeJob?.needs, ['inspect-runner-registration']);
    assert.deepEqual(smokeJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(
      workflowText.includes('classroompath-windows-103'),
      'self-hosted Windows runner smoke should verify the expected ClassroomPath runner name'
    );
    assert.ok(
      workflowText.includes('actions/checkout@v6') &&
        workflowText.includes('persist-credentials: false'),
      'self-hosted Windows runner smoke should use checkout without persisted credentials'
    );
    assert.ok(
      workflowText.includes('./.github/actions/restore-windows-runner-dns') &&
        workflowText.includes('Test-NetConnection github.com -Port 443'),
      'watchdog smoke must restore DNS and prove GitHub connectivity from the Windows runner'
    );
  });

  test('OpenPath sync workflow automates checked handoff without depending on OpenPath callbacks', () => {
    const workflowText = readText('.github/workflows/sync-openpath.yml');
    const workflow = readWorkflow('.github/workflows/sync-openpath.yml');
    const syncJob = findWorkflowJob(workflow, 'sync');
    const resolveModeStep = findWorkflowStepByName(syncJob, 'Resolve sync mode');
    const verifyStep = findWorkflowStepByName(syncJob, 'Verify OpenPath upstream checks');
    const directPushStep = findWorkflowStepByName(syncJob, 'Commit and push direct sync');
    const pullRequestStep = findWorkflowStepByName(syncJob, 'Open Pull Request');

    assert.equal(workflow.on?.schedule?.[0]?.cron, '*/5 * * * *');
    assert.match(
      String(resolveModeStep.run ?? ''),
      /github\.event_name[\s\S]*mode="direct-main"/,
      'scheduled sync should default to direct-main mode'
    );
    assert.match(
      String(verifyStep.run ?? ''),
      /OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS=2400[\s\S]*node scripts\/openpath-required-checks\.mjs wait/,
      'sync must wait for the same upstream quality gate before updating the submodule'
    );
    assert.match(
      String(directPushStep.if ?? ''),
      /steps\.mode\.outputs\.mode == 'direct-main'/,
      'direct handoff should be gated to direct-main mode'
    );
    assert.match(
      String(directPushStep.run ?? ''),
      /CLASSROOMPATH_SYNC_TOKEN[\s\S]*x-access-token:\$\{CLASSROOMPATH_SYNC_TOKEN\}[\s\S]*HEAD:main/,
      'direct handoff should push with a ClassroomPath-owned token so downstream CI runs'
    );
    assert.match(
      String(pullRequestStep.if ?? ''),
      /steps\.mode\.outputs\.mode == 'pull-request'/,
      'manual fallback should retain the pull request path'
    );
    assert.ok(
      !workflowText.includes('repository_dispatch') && !workflowText.includes('workflow_run'),
      'ClassroomPath sync should not require an OpenPath-side callback'
    );
  });

  test('CI workflow keeps structured change detection, regression routing, and verification reporting', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const productJob = workflow.jobs?.['product-validation'];
    const opsJob = workflow.jobs?.['ops-regression'];
    const releaseAutomationJob = workflow.jobs?.['release-automation'];
    const detectJob = workflow.jobs?.['detect-relevant-changes'];
    const opsSteps = opsJob?.steps ?? [];
    const releaseAutomationSteps = releaseAutomationJob?.steps ?? [];
    const detectStep = (detectJob?.steps ?? []).find((step) => step.id === 'filter');
    const regressionStep = opsSteps.find((step) => step.name === 'Run ops regression tests');
    const releaseRegressionStep = releaseAutomationSteps.find(
      (step) => step.name === 'Run release automation regression tests'
    );
    const summaryStep = opsSteps.find((step) => step.name === 'Summarize verification report');
    const uploadStep = opsSteps.find((step) => step.name === 'Upload verification report artifact');
    const packageJson = readPackageJson();
    const verifyFast = packageJson.scripts?.['verify:fast'] ?? '';
    const commitSmoke = packageJson.scripts?.['test:e2e:commit-smoke'] ?? '';
    const ciRegression = packageJson.scripts?.['test:ci-regression'] ?? '';
    const releaseAutomationRegression = packageJson.scripts?.['test:release-automation'] ?? '';
    const ciRegressionHelper = readText('scripts/run-ci-regression.mjs');
    const regressionPlan = readText('scripts/lib/regression-plan.mjs');
    const verificationCatalog = readText('scripts/lib/verification-catalog.mjs');
    const summaryScript = readText('scripts/print-verify-report-summary.mjs');
    const detectorScript = readText('scripts/detect-ci-relevant-changes.mjs');
    const reportContract = readText('scripts/lib/verification-report-contract.mjs');

    assert.ok(workflow.jobs?.['detect-relevant-changes']);
    assert.equal(workflow.jobs?.['ci-success']?.name, 'CI Success');
    assert.equal(productJob?.name, 'Product Validation');
    assert.equal(opsJob?.name, 'Ops Regression');
    assert.equal(releaseAutomationJob?.name, 'Release Automation Regression');
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['domain_owners'],
      '${{ steps.filter.outputs.domain_owners }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['reviewers'],
      '${{ steps.filter.outputs.reviewers }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['product_validation'],
      '${{ steps.filter.outputs.product_validation }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['ops_regression'],
      '${{ steps.filter.outputs.ops_regression }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['release_automation'],
      '${{ steps.filter.outputs.release_automation }}'
    );
    assert.ok(workflow.jobs?.['product-validation']);
    assert.ok(workflow.jobs?.['ops-regression']);
    assert.ok(workflow.jobs?.['release-automation']);
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['release_gates'],
      '${{ steps.filter.outputs.release_gates }}'
    );
    assert.equal(String(regressionStep?.run ?? '').includes('npm run test:ci-regression'), true);
    assert.equal(
      String(releaseRegressionStep?.run ?? '').includes('npm run test:release-automation'),
      true
    );
    assert.match(String(regressionStep?.run ?? ''), /VERIFY_REPORT_FILE=/);
    assert.ok(String(summaryStep?.run ?? '').includes('scripts/print-verify-report-summary.mjs'));
    assert.equal(uploadStep?.uses, 'actions/upload-artifact@v7');
    assert.equal(String(uploadStep?.with?.name ?? ''), 'classroompath-ops-regression-report');
    assert.ok(String(detectStep?.run ?? '').includes('scripts/detect-ci-relevant-changes.mjs'));
    assert.ok(
      !String(detectStep?.run ?? '').includes("grep -Eq '^(api/|react-spa/|docker/|scripts/")
    );
    assert.equal(verifyFast, 'VERIFY_MODE=fast bash scripts/verify-full.sh');
    assert.match(commitSmoke, /playwright test --grep @commit-smoke/);
    assert.doesNotMatch(commitSmoke, /test:e2e:full/);
    assert.match(
      ciRegression,
      /^node --input-type=module -e "import \{ runCiRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runCiRegression\(\);" && node --input-type=module -e "import \{ runWorkflowConfigRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runWorkflowConfigRegression\(\);"$/
    );
    assert.match(
      releaseAutomationRegression,
      /^node --input-type=module -e "import \{ runReleaseAutomationRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runReleaseAutomationRegression\(\);"$/
    );
    assert.match(summaryScript, /readAndFormatVerificationReportSummary/);
    assert.match(detectorScript, /summarizeVerificationDomains/);
    assert.match(
      reportContract,
      /VERIFICATION_REPORT_ARTIFACT_NAME = 'classroompath-ci-verification-report'/
    );
    assert.match(detectorScript, /reviewers: summary\.reviewers\.join\(','\)/);
    assert.match(detectorScript, /release_gates: summary\.releaseGates\.join\(','\)/);
    assert.match(regressionPlan, /verification-catalog\.mjs/);
    assert.match(ciRegressionHelper, /resolveRegressionPlan\('ci'\)/);
    assert.match(ciRegressionHelper, /resolveRegressionPlan\('workflow-config'\)/);
    assert.match(ciRegressionHelper, /resolveRegressionPlan\('release-automation'\)/);
    assert.match(
      ciRegressionHelper,
      /spawnSync\(process\.execPath, \['--import', 'tsx', '--test', testFile\]/
    );
    assert.match(ciRegressionHelper, /!key\.startsWith\('npm_'\)/);
    assert.match(verificationCatalog, /tests\/workflow-core\.test\.ts/);
    assert.match(verificationCatalog, /tests\/ci-cache-measurement\.test\.ts/);
    assert.match(verificationCatalog, /tests\/ci-routing-measurement\.test\.ts/);
    assert.match(verificationCatalog, /measure-release-candidate-timings/);
    assert.match(verificationCatalog, /release-candidate-components/);
    assert.match(verificationCatalog, /tests\/release-candidate-timings\.test\.ts/);
    assert.match(verificationCatalog, /tests\/release-candidate-components\.test\.ts/);
    assert.match(verificationCatalog, /tests\/workflow-deploy\.test\.ts/);
    assert.match(verificationCatalog, /tests\/workflow-production-client-canary\.test\.ts/);
    assert.match(verificationCatalog, /tests\/workflow-release-candidate\.test\.ts/);
  });

  test('CI change detector exposes independent validation scopes', async () => {
    const { detectCiRelevantChanges } = await import('../scripts/detect-ci-relevant-changes.mjs');

    assert.deepEqual(detectCiRelevantChanges(['react-spa/src/ClassroomPathShell.tsx']), {
      ci_relevant: 'true',
      product_validation: 'true',
      ops_regression: 'false',
      release_automation: 'false',
      domain_owners: 'application',
      release_gates: 'staging-release-gate',
      required_approvals: 'application',
      reviewers: 'application',
    });

    assert.equal(
      detectCiRelevantChanges(['scripts/deploy-production-remote.sh']).ops_regression,
      'true'
    );
    assert.equal(detectCiRelevantChanges(['.github/workflows/ci.yml']).release_automation, 'true');
  });

  test('CI and security workflows keep shared dependency and cache policy', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['product-validation'];
    const steps = buildJob?.steps ?? [];
    const classroomPathInstall = steps.find(
      (step) => step.name === 'Install ClassroomPath dependencies'
    );
    const openPathInstall = steps.find(
      (step) => step.name === 'Install OpenPath submodule dependencies'
    );
    const setupNodeStep = steps.find((step) => step.name === 'Setup Node.js');
    const securityWorkflowDefinition = readWorkflow('.github/workflows/security.yml');
    const secretScanJob = findWorkflowJob(securityWorkflowDefinition, 'secret-scan');
    const secretScanCheckoutStep = findWorkflowStepByName(secretScanJob, 'Checkout code');
    const gitleaksInstallStep = findWorkflowStepByName(secretScanJob, 'Install Gitleaks');
    const gitleaksStep = findWorkflowStepByName(secretScanJob, 'Run Gitleaks');
    const gitleaksSarifStep = findWorkflowStepByName(secretScanJob, 'Upload Gitleaks SARIF');
    const securityWorkflow = readText('.github/workflows/security.yml');
    const setupNodeAction = readText('.github/actions/setup-node/action.yml');

    assert.equal(classroomPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.['working-directory'], 'upstream/openpath');
    assert.equal(setupNodeStep?.uses, './.github/actions/setup-node');
    assert.match(
      String(setupNodeStep?.with?.['cache-dependency-path'] ?? ''),
      /package-lock\.json[\s\S]*upstream\/openpath\/package-lock\.json/
    );
    assert.ok(securityWorkflow.includes('aquasecurity/trivy-action@v0.35.0'));
    assert.ok(!securityWorkflow.includes('aquasecurity/trivy-action@master'));
    assert.ok(securityWorkflow.includes('./.github/actions/setup-node'));
    assert.ok(securityWorkflow.includes('github/codeql-action/upload-sarif@v4'));
    assert.ok(!securityWorkflow.includes('github/codeql-action/upload-sarif@v3'));
    assert.equal(secretScanCheckoutStep?.with?.['fetch-depth'], 0);
    assert.match(String(gitleaksInstallStep?.run ?? ''), /version="8\.30\.1"/);
    assert.match(String(gitleaksInstallStep?.run ?? ''), /gitleaks_\$\{version\}_checksums\.txt/);
    assert.match(String(gitleaksInstallStep?.run ?? ''), /sha256sum -c/);
    assert.equal(
      (gitleaksStep as { env?: Record<string, unknown> })?.env?.GITHUB_BEFORE_SHA,
      '${{ github.event.before }}'
    );
    assert.match(String(gitleaksStep?.run ?? ''), /\/tmp\/gitleaks detect/);
    assert.equal(gitleaksSarifStep?.uses, 'github/codeql-action/upload-sarif@v4');
    assert.equal(gitleaksSarifStep?.with?.sarif_file, 'results.sarif');
    assert.doesNotMatch(securityWorkflow, /gitleaks\/gitleaks-action/);
    assert.doesNotMatch(securityWorkflow, /gacts\/gitleaks/);
    assert.doesNotMatch(securityWorkflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24/);
    assert.ok(setupNodeAction.includes("cache: 'npm'") || setupNodeAction.includes('cache: npm'));
  });

  test('ClassroomPath npm install jobs use the shared cache-enabled setup-node action', () => {
    for (const workflowPath of [
      '.github/workflows/ci.yml',
      '.github/workflows/firefox-release-assets.yml',
      '.github/workflows/release-candidate-images.yml',
      '.github/workflows/security.yml',
    ]) {
      assertNpmCiJobsUseSharedNodeSetup(workflowPath);
    }
  });

  test('staging cleanup workflow runs recurring non-disruptive disk maintenance', () => {
    const cleanupWorkflowPath = '.github/workflows/cleanup-staging.yml';
    const cleanupWorkflow = readWorkflow(cleanupWorkflowPath);
    const cleanupWorkflowText = readText(cleanupWorkflowPath);
    const cleanupJob = findWorkflowJob(cleanupWorkflow, 'cleanup-staging');
    const steps = cleanupJob.steps ?? [];
    const checkoutStep = steps.find((step) => step.uses === 'actions/checkout@v6');
    const cleanupStep = findWorkflowStepByName(cleanupJob, 'Check and clean staging disk via SSH');
    const cleanupScript = String(cleanupStep.run ?? cleanupStep.with?.script ?? '');

    assert.ok(cleanupWorkflowText.includes('schedule:'));
    assert.ok(cleanupWorkflowText.includes('cron:'));
    assert.ok(checkoutStep, 'cleanup workflow should check out scripts before resolving SSH host');
    assert.ok(cleanupScript.includes('docker system prune -af'));
    assert.ok(cleanupScript.includes('docker builder prune -af'));
    assert.ok(cleanupScript.includes('GITHUB_STEP_SUMMARY'));
    assert.ok(cleanupScript.includes('::warning::'));
    assert.ok(cleanupScript.includes('::error::'));
    assert.ok(cleanupScript.includes('exit 1'));
    assert.doesNotMatch(cleanupScript, /docker stop\b/);
    assert.doesNotMatch(cleanupScript, /docker rm -f\b/);
    assert.doesNotMatch(cleanupScript, /docker compose down\b/);
    assert.doesNotMatch(cleanupScript, /--volumes\b/);
  });

  test('Windows canary workflows keep live staging and production bootstrap coverage', () => {
    const windowsFirefoxWorkflowText = readText('.github/workflows/windows-firefox-canary.yml');
    const windowsFirefoxWorkflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const windowsFirefoxJob = windowsFirefoxWorkflow.jobs?.['windows-firefox-canary'];
    const windowsFirefoxSteps = Array.isArray(windowsFirefoxJob?.steps)
      ? windowsFirefoxJob.steps
      : [];

    assert.ok(windowsFirefoxJob);
    assert.deepEqual(windowsFirefoxJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(windowsFirefoxWorkflowText.includes('workflow_call'));
    assert.ok(windowsFirefoxWorkflowText.includes('staging-verification.env'));
    assert.ok(windowsFirefoxWorkflowText.includes('RUNNER_ENVIRONMENT_CONTEXT'));
    assert.ok(windowsFirefoxWorkflowText.includes('STAGING_DEPLOY_LAN_HOST: 192.168.1.114'));
    assert.ok(windowsFirefoxWorkflowText.includes('STAGING_DEPLOY_LAN_PORT: 22'));
    assert.ok(
      windowsFirefoxSteps.some(
        (step) => typeof step === 'object' && step !== null && step.uses === 'actions/checkout@v6'
      )
    );
    assert.ok(windowsFirefoxWorkflowText.includes('policies.json'));
    assert.ok(
      windowsFirefoxWorkflowText.includes('firefox.exe') ||
        windowsFirefoxWorkflowText.includes('Mozilla Firefox')
    );
    assert.ok(windowsFirefoxWorkflowText.includes('openpath-firefox-extension.xpi'));
    assert.ok(
      windowsFirefoxWorkflowText.includes('deploy-targets.mjs get staging publicUrl') &&
        windowsFirefoxWorkflowText.includes('/api/extensions/firefox/openpath.xpi')
    );
    assert.ok(!windowsFirefoxWorkflowText.includes('file:///'));
    assert.ok(windowsFirefoxWorkflowText.includes('extensions.json'));

    const productionBootstrapWorkflowPath =
      '.github/workflows/windows-production-bootstrap-canary.yml';
    const productionBootstrapWorkflowText = readText(productionBootstrapWorkflowPath);
    const productionBootstrapWorkflow = readWorkflow(productionBootstrapWorkflowPath);
    const productionBootstrapJob =
      productionBootstrapWorkflow.jobs?.['windows-production-bootstrap-canary'];
    const productionBootstrapSteps = Array.isArray(productionBootstrapJob?.steps)
      ? productionBootstrapJob.steps
      : [];
    const bootstrapCanaryScriptText = readText(
      'scripts/create-production-windows-bootstrap-canary.mjs'
    );

    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/create-production-windows-bootstrap-canary.mjs'))
    );
    assert.ok(productionBootstrapWorkflow.on?.workflow_dispatch);
    assert.ok(productionBootstrapJob);
    assert.deepEqual(productionBootstrapJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(!productionBootstrapWorkflowText.includes('DEPLOY_LAN_HOST'));
    assert.ok(!productionBootstrapWorkflowText.includes('DEPLOY_LAN_PORT'));
    assert.ok(
      productionBootstrapSteps.some(
        (step) =>
          typeof step === 'object' && step !== null && step.uses === './.github/actions/setup-node'
      )
    );
    const setupNodeStep = productionBootstrapSteps.find(
      (step) => typeof step === 'object' && step !== null && step.name === 'Setup Node.js'
    );
    assert.equal(String(setupNodeStep?.with?.['enable-cache'] ?? ''), 'false');
    assert.ok(
      productionBootstrapWorkflowText.includes('create-production-windows-bootstrap-canary.mjs')
    );
    assert.ok(
      bootstrapCanaryScriptText.includes("'billing.createCheckout'") &&
        bootstrapCanaryScriptText.includes('/cp/stripe/webhook')
    );
    assert.ok(!bootstrapCanaryScriptText.includes("'onboarding.createOrganization'"));
    assert.ok(
      productionBootstrapWorkflowText.includes('github_actions_remote_read_env_key') &&
        productionBootstrapWorkflowText.includes('CP_CLIENT_CANARY_ADMIN_TOKEN') &&
        productionBootstrapWorkflowText.includes(
          'PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'
        ) &&
        productionBootstrapWorkflowText.includes(
          'PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET'
        ) &&
        productionBootstrapWorkflowText.includes('classroompath-production-release')
    );
    assert.ok(
      !productionBootstrapWorkflowText.includes(
        'Skip bootstrap canary when production is manual-only'
      )
    );
    assert.ok(
      productionBootstrapWorkflowText.includes('/api/enroll/') &&
        productionBootstrapWorkflowText.includes('windows.ps1')
    );
    assert.ok(productionBootstrapWorkflowText.includes('Reset persistent Windows canary state'));
    assert.ok(productionBootstrapWorkflowText.includes("Get-ScheduledTask -TaskName 'OpenPath-*'"));
    assert.ok(productionBootstrapWorkflowText.includes("Remove-Item -LiteralPath 'C:\\OpenPath'"));
    assert.ok(productionBootstrapWorkflowText.includes('Acrylic DNS Proxy'));
    assert.ok(productionBootstrapWorkflowText.includes('browser-policy-spec.json'));
    assert.ok(productionBootstrapWorkflowText.includes('Update-OpenPath.ps1'));
    assert.ok(productionBootstrapWorkflowText.includes('Browser policy spec not found'));
    assert.ok(
      productionBootstrapWorkflowText.includes('disabled=True') &&
        productionBootstrapWorkflowText.includes('DEACTIVATION FLAG detected')
    );
    assert.ok(
      productionBootstrapWorkflowText.includes('policies.json') &&
        productionBootstrapWorkflowText.includes('force_installed')
    );
    assert.ok(productionBootstrapWorkflowText.includes('extensions.json'));
    assert.ok(productionBootstrapWorkflowText.includes('classroompath.eu'));
  });
});
