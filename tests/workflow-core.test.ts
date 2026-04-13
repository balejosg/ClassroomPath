import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertTextExcludesAll,
  assertTextIncludesAll,
  readProjectText,
  readProjectWorkflow,
  type WorkflowDefinition,
} from './helpers/ops-contracts.ts';

type WorkflowJob = {
  name?: string;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  'runs-on'?: string | string[];
  uses?: string;
  secrets?: string | Record<string, string>;
  with?: Record<string, unknown>;
  steps?: Array<{
    name?: string;
    id?: string;
    if?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    'continue-on-error'?: boolean;
    'working-directory'?: string;
  }>;
};

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

function normalizeNeeds(needs: WorkflowJob['needs']): string[] {
  if (!needs) {
    return [];
  }

  return Array.isArray(needs) ? needs : [needs];
}

function readPackageJson(): PackageDefinition {
  return JSON.parse(readProjectText('package.json')) as PackageDefinition;
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

  test('CI workflow keeps structured change detection, regression routing, and verification reporting', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const detectJob = workflow.jobs?.['detect-relevant-changes'];
    const steps = buildJob?.steps ?? [];
    const detectStep = (detectJob?.steps ?? []).find((step) => step.id === 'filter');
    const regressionStep = steps.find((step) => step.name === 'Run CI regression tests');
    const summaryStep = steps.find((step) => step.name === 'Summarize verification report');
    const uploadStep = steps.find((step) => step.name === 'Upload verification report artifact');
    const packageJson = readPackageJson();
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
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['domain_owners'],
      '${{ steps.filter.outputs.domain_owners }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['reviewers'],
      '${{ steps.filter.outputs.reviewers }}'
    );
    assert.equal(
      workflow.jobs?.['detect-relevant-changes']?.outputs?.['release_gates'],
      '${{ steps.filter.outputs.release_gates }}'
    );
    assert.equal(String(regressionStep?.run ?? '').includes('npm run test:ci-regression'), true);
    assert.match(String(regressionStep?.run ?? ''), /VERIFY_REPORT_FILE=/);
    assert.ok(String(summaryStep?.run ?? '').includes('scripts/print-verify-report-summary.mjs'));
    assert.equal(uploadStep?.uses, 'actions/upload-artifact@v7');
    assert.equal(String(uploadStep?.with?.name ?? ''), 'classroompath-ci-verification-report');
    assert.ok(String(detectStep?.run ?? '').includes('scripts/detect-ci-relevant-changes.mjs'));
    assert.ok(
      !String(detectStep?.run ?? '').includes("grep -Eq '^(api/|react-spa/|docker/|scripts/")
    );
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
    assert.match(verificationCatalog, /tests\/workflow-release-candidate\.test\.ts/);
  });

  test('CI and security workflows keep shared dependency and cache policy', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const steps = buildJob?.steps ?? [];
    const classroomPathInstall = steps.find(
      (step) => step.name === 'Install ClassroomPath dependencies'
    );
    const openPathInstall = steps.find(
      (step) => step.name === 'Install OpenPath submodule dependencies'
    );
    const setupNodeStep = steps.find((step) => step.name === 'Setup Node.js');
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
    assert.ok(setupNodeAction.includes("cache: 'npm'") || setupNodeAction.includes('cache: npm'));
  });

  test('deploy and smoke workflows reuse shared transport, verifier, and concurrency helpers', () => {
    const deployWorkflow = readWorkflow('.github/workflows/deploy.yml');
    const deployWorkflowText = readText('.github/workflows/deploy.yml');
    const smokeWorkflowText = readText('.github/workflows/smoke-tests.yml');
    const reusableSmokeWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');
    const cleanupWorkflow = readText('.github/workflows/cleanup-staging.yml');
    const canaryWorkflow = readText('.github/workflows/windows-firefox-canary.yml');
    const concurrency = deployWorkflow.concurrency;
    const jobs = deployWorkflow.jobs ?? {};

    assert.ok(smokeWorkflowText.includes('./.github/workflows/reusable-smoke-test.yml'));
    assert.ok(smokeWorkflowText.includes('resolve-latest-verifier-image.mjs'));
    assert.ok(reusableSmokeWorkflowText.includes('run-smoke-in-verifier.sh'));
    assert.ok(reusableSmokeWorkflowText.includes('verifier_image:'));
    assert.ok(reusableSmokeWorkflowText.includes('wait-for-ready.sh'));
    assert.ok(!reusableSmokeWorkflowText.includes('npm ci'));
    assert.ok(deployWorkflowText.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(canaryWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(cleanupWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(!deployWorkflowText.includes('DEPLOY_HOST not configured. Skipping deployment.'));
    assert.ok(deployWorkflowText.includes('verify-staging-release-state.sh'));
    assert.ok(deployWorkflowText.includes('detect-windows-firefox-risk.sh'));
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

  test('Windows canary workflows keep live staging and production bootstrap coverage', () => {
    const windowsFirefoxWorkflowText = readText('.github/workflows/windows-firefox-canary.yml');
    const windowsFirefoxWorkflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const windowsFirefoxJob = windowsFirefoxWorkflow.jobs?.['windows-firefox-canary'];
    const windowsFirefoxSteps = Array.isArray(windowsFirefoxJob?.steps)
      ? windowsFirefoxJob.steps
      : [];

    assert.ok(windowsFirefoxJob);
    assert.equal(windowsFirefoxJob?.['runs-on'], 'windows-latest');
    assert.ok(windowsFirefoxWorkflowText.includes('workflow_call'));
    assert.ok(windowsFirefoxWorkflowText.includes('staging-verification.env'));
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
    assert.equal(productionBootstrapJob?.['runs-on'], 'windows-latest');
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
      productionBootstrapWorkflowText.includes("grep '^CP_BILLING_MODE='") &&
        productionBootstrapWorkflowText.includes(
          'Skip bootstrap canary when production is manual-only'
        ) &&
        productionBootstrapWorkflowText.includes(
          'PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET'
        ) &&
        productionBootstrapWorkflowText.includes('classroompath-production-release')
    );
    assert.ok(
      productionBootstrapWorkflowText.includes('/api/enroll/') &&
        productionBootstrapWorkflowText.includes('windows.ps1')
    );
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

  test('post-release production client update canary stays decoupled from deploy completion', () => {
    const workflowPath = '.github/workflows/production-client-update-canary.yml';
    const workflowText = readText(workflowPath);
    const workflow = readWorkflow(workflowPath);
    const jobs = workflow.jobs ?? {};
    const windowsJob = jobs['windows-client-self-update-canary'];
    const linuxJob = jobs['linux-client-self-update-canary'];

    assert.ok(workflow.on?.workflow_run?.workflows?.includes('Deploy'));
    assert.ok(workflow.on?.workflow_run?.types?.includes('completed'));
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(!workflowText.includes('workflow_call:'));
    assert.equal(windowsJob?.['runs-on'], 'windows-latest');
    assert.equal(linuxJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(workflowText.includes('create-production-windows-bootstrap-canary.mjs'));
    assert.ok(
      workflowText.includes("grep '^CP_BILLING_MODE='") &&
        workflowText.includes('Skip production client update canary when billing is manual-only') &&
        workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('classroompath-production-release')
    );
    assert.ok(
      workflowText.includes('OpenPath.ps1') && workflowText.includes('self-update --silent')
    );
    assert.ok(workflowText.includes('config.json') && workflowText.includes('lastAgentUpdateAt'));
    assert.ok(
      workflowText.includes('/api/enroll/$CLASSROOM_ID') &&
        workflowText.includes('sudo bash "$enroll_script"')
    );
    assert.ok(workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'));
    assert.ok(workflowText.includes('openpath-agent-update.timer'));
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
  });
});
