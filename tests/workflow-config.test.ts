import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

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

type WorkflowDefinition = {
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  on?: {
    push?: {
      branches?: string[];
      tags?: string[];
      paths?: string[];
    };
    workflow_run?: {
      workflows?: string[];
      types?: string[];
    };
    workflow_call?: Record<string, unknown>;
    workflow_dispatch?: Record<string, never>;
  };
  jobs?: Record<string, WorkflowJob>;
};

type PackageDefinition = {
  scripts?: Record<string, string>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

function readWorkflow(relativePath: string): WorkflowDefinition {
  const workflowPath = resolve(projectRoot, relativePath);
  assert.ok(existsSync(workflowPath), `${relativePath} should exist`);
  return parseYaml(readFileSync(workflowPath, 'utf-8')) as WorkflowDefinition;
}

function normalizeNeeds(needs: WorkflowJob['needs']): string[] {
  if (!needs) {
    return [];
  }

  return Array.isArray(needs) ? needs : [needs];
}

function readText(relativePath: string): string {
  const filePath = resolve(projectRoot, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} should exist`);
  return readFileSync(filePath, 'utf-8');
}

function readPackageJson(): PackageDefinition {
  return JSON.parse(readText('package.json')) as PackageDefinition;
}

describe('Workflow configuration hardening', () => {
  test('GitHub Actions workflows pin Node 24 compatible action majors', () => {
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
        relativePath: '.github/workflows/release-candidate-images.yml',
        required: [
          './.github/workflows/reusable-release-candidate-image-family.yml',
          './.github/workflows/firefox-release-assets.yml',
        ],
        forbidden: [
          'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
          'docker/setup-buildx-action@v3',
          'docker/login-action@v3',
          'docker/build-push-action@v6',
        ],
      },
      {
        relativePath: '.github/actions/setup-docker-build/action.yml',
        required: ['docker/setup-buildx-action@v4', 'docker/login-action@v4'],
        forbidden: ['docker/setup-buildx-action@v3', 'docker/login-action@v3'],
      },
      {
        relativePath: '.github/actions/build-release-candidate-image/action.yml',
        required: ['docker/build-push-action@v7', 'actions/download-artifact@v7'],
        forbidden: ['docker/build-push-action@v6', 'actions/download-artifact@v4'],
      },
      {
        relativePath: '.github/actions/publish-release-candidate-manifest/action.yml',
        required: ['./.github/actions/setup-docker-build'],
        forbidden: ['docker/login-action@v3'],
      },
      {
        relativePath: '.github/workflows/reusable-release-candidate-image-family.yml',
        required: [
          './.github/actions/build-release-candidate-image',
          './.github/actions/publish-release-candidate-manifest',
        ],
        forbidden: ['docker/build-push-action@v6', 'actions/download-artifact@v4'],
      },
      {
        relativePath: '.github/workflows/deploy.yml',
        required: ['docker/login-action@v4', './.github/actions/setup-node'],
        forbidden: ['docker/login-action@v3'],
      },
    ];

    for (const { relativePath, required, forbidden } of cases) {
      const content = readText(relativePath);

      for (const version of required) {
        assert.ok(content.includes(version), `${relativePath} should include ${version}`);
      }

      for (const version of forbidden) {
        assert.ok(!content.includes(version), `${relativePath} should not include ${version}`);
      }
    }
  });

  test('CI workflow exists and defines a stable CI Success summary job', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(jobs['detect-relevant-changes'], 'CI workflow should detect relevant changes');
    assert.equal(jobs['ci-success']?.name, 'CI Success');
    assert.equal(
      jobs['detect-relevant-changes']?.outputs?.['domain_owners'],
      '${{ steps.filter.outputs.domain_owners }}',
      'CI workflow should expose verification domain owners from the shared change detector'
    );
    assert.equal(
      jobs['detect-relevant-changes']?.outputs?.['reviewers'],
      '${{ steps.filter.outputs.reviewers }}',
      'CI workflow should expose reviewer groups from the shared change detector'
    );
    assert.equal(
      jobs['detect-relevant-changes']?.outputs?.['release_gates'],
      '${{ steps.filter.outputs.release_gates }}',
      'CI workflow should expose release-gate impact from the shared change detector'
    );
  });

  test('release candidate detector rebuilds dependent images when the OpenPath gitlink changes', () => {
    const detectScriptPath = resolve(projectRoot, 'scripts/detect-release-candidate-components.sh');
    const detectScript = readFileSync(detectScriptPath, 'utf-8');

    assert.match(
      detectScript,
      /mark_all_changed\(\) \{[\s\S]*gateway_changed=true[\s\S]*migrations_changed=true[\s\S]*openpath_api_changed=true[\s\S]*spa_changed=true[\s\S]*verifier_changed=true[\s\S]*\}/,
      'release candidate detector should keep a single helper that marks every image family as changed'
    );
    assert.match(
      detectScript,
      /upstream\/openpath\|upstream\/openpath\/\*\)[\s\S]*mark_all_changed/,
      'OpenPath gitlink updates should fan out to every release-candidate image family'
    );
  });

  test('release candidate workflow inherits Firefox signing secrets into the reusable asset job', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const firefoxAssetsJob = workflow.jobs?.['resolve-openpath-firefox-release-assets'];

    assert.equal(
      firefoxAssetsJob?.uses,
      './.github/workflows/firefox-release-assets.yml',
      'release candidate workflow should resolve Firefox assets through the reusable workflow'
    );
    assert.equal(
      firefoxAssetsJob?.secrets,
      'inherit',
      'release candidate workflow should inherit Firefox signing secrets into the reusable asset workflow'
    );
  });

  test('CI workflow installs OpenPath submodule dependencies before building', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const steps = buildJob?.steps ?? [];

    const classroomPathInstall = steps.find(
      (step) => step.name === 'Install ClassroomPath dependencies'
    );
    const openPathInstall = steps.find(
      (step) => step.name === 'Install OpenPath submodule dependencies'
    );

    assert.equal(classroomPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.['working-directory'], 'upstream/openpath');
  });

  test('CI workflow summarizes the machine-readable verification report after regression runs', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const steps = buildJob?.steps ?? [];
    const regressionStep = steps.find((step) => step.name === 'Run CI regression tests');
    const summaryStep = steps.find((step) => step.name === 'Summarize verification report');
    const uploadStep = steps.find((step) => step.name === 'Upload verification report artifact');
    const summaryScript = readText('scripts/print-verify-report-summary.mjs');
    const detectorScript = readText('scripts/detect-ci-relevant-changes.mjs');
    const reportContract = readText('scripts/lib/verification-report-contract.mjs');

    assert.match(
      String(regressionStep?.run ?? ''),
      /VERIFY_REPORT_FILE=/,
      'CI regression should emit a machine-readable verification report'
    );
    assert.ok(
      String(summaryStep?.run ?? '').includes('scripts/print-verify-report-summary.mjs'),
      'CI workflow should summarize the verification report through the shared CLI wrapper'
    );
    assert.match(
      summaryScript,
      /readAndFormatVerificationReportSummary/,
      'the verification summary CLI should delegate formatting to the shared report-consumer library'
    );
    assert.match(
      detectorScript,
      /summarizeVerificationDomains/,
      'CI change detection should delegate relevance and approval ownership to the shared verification catalog'
    );
    assert.equal(
      uploadStep?.uses,
      'actions/upload-artifact@v7',
      'CI workflow should publish the verification report as a canonical artifact'
    );
    assert.equal(
      String(uploadStep?.with?.name ?? ''),
      'classroompath-ci-verification-report',
      'CI workflow should use a stable artifact name for verification consumers'
    );
    assert.match(
      reportContract,
      /VERIFICATION_REPORT_ARTIFACT_NAME = 'classroompath-ci-verification-report'/,
      'the verification report contract should define the canonical artifact name'
    );
    assert.match(
      detectorScript,
      /reviewers: summary\.reviewers\.join\(','\)/,
      'CI change detection should emit reviewer groups from the shared verification catalog'
    );
    assert.match(
      detectorScript,
      /release_gates: summary\.releaseGates\.join\(','\)/,
      'CI change detection should emit release-gate impact from the shared verification catalog'
    );
  });

  test('CI workflow caches npm installs for ClassroomPath and OpenPath lockfiles', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const setupNodeStep = (buildJob?.steps ?? []).find((step) => step.name === 'Setup Node.js');

    assert.equal(setupNodeStep?.uses, './.github/actions/setup-node');
    assert.match(
      String(setupNodeStep?.with?.['cache-dependency-path'] ?? ''),
      /package-lock\.json[\s\S]*upstream\/openpath\/package-lock\.json/,
      'CI should cache both ClassroomPath and OpenPath npm installs'
    );
  });

  test('CI regression command is routed through package.json and includes agent doc drift checks', () => {
    const packageJson = readPackageJson();
    const ciRegression = packageJson.scripts?.['test:ci-regression'] ?? '';
    const releaseAutomationRegression = packageJson.scripts?.['test:release-automation'] ?? '';
    const ciRegressionHelper = readText('scripts/run-ci-regression.mjs');
    const regressionPlan = readText('scripts/lib/regression-plan.mjs');
    const verificationCatalog = readText('scripts/lib/verification-catalog.mjs');

    assert.match(
      ciRegression,
      /^node --input-type=module -e "import \{ runCiRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runCiRegression\(\);" && node --input-type=module -e "import \{ runWorkflowConfigRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runWorkflowConfigRegression\(\);"$/,
      'package.json should run the sequential CI regression block and workflow-config in separate sanitized Node processes'
    );
    assert.match(
      verificationCatalog,
      /tests\/agent-docs-consistency\.test\.ts/,
      'regression plan should include the agent docs consistency suite'
    );
    assert.match(
      verificationCatalog,
      /api\/tests\/openpath-proxy-policy\.test\.ts/,
      'regression plan should include the gateway passthrough contract suites'
    );
    assert.match(
      regressionPlan,
      /verification-catalog\.mjs/,
      'regression-plan should delegate to the shared verification catalog'
    );
    assert.match(
      ciRegressionHelper,
      /resolveRegressionPlan\('ci'\)/,
      'CI regression helper should resolve the shared CI plan from the declarative regression plan module'
    );
    assert.match(
      ciRegressionHelper,
      /resolveRegressionPlan\('workflow-config'\)/,
      'workflow-config should stay a distinct declarative regression plan'
    );
    assert.match(
      ciRegressionHelper,
      /export function runCiRegression\(\)/,
      'CI regression helper should expose a reusable runner function'
    );
    assert.match(
      ciRegressionHelper,
      /export function runWorkflowConfigRegression\(\)/,
      'CI regression helper should expose a dedicated workflow-config runner too'
    );
    assert.match(
      releaseAutomationRegression,
      /^node --input-type=module -e "import \{ runReleaseAutomationRegression \} from '\.\/scripts\/run-ci-regression\.mjs'; runReleaseAutomationRegression\(\);"$/,
      'package.json should expose a dedicated release-automation regression script'
    );
    assert.match(
      ciRegressionHelper,
      /export function runReleaseAutomationRegression\(\)/,
      'CI regression helper should expose a release-automation runner'
    );
    assert.match(
      ciRegressionHelper,
      /resolveRegressionPlan\('release-automation'\)/,
      'release-automation regression should resolve from the shared declarative plan'
    );
    assert.match(
      verificationCatalog,
      /tests\/release-images\.test\.ts/,
      'regression plan should include the release image helper contract suite'
    );
    assert.match(
      verificationCatalog,
      /tests\/release-cli\.test\.ts/,
      'regression plan should include the shared release CLI contract suite'
    );
    assert.match(
      verificationCatalog,
      /tests\/verify-cache\.test\.ts/,
      'release-automation regression should validate the artifact-aware verify cache contract'
    );
    assert.match(
      verificationCatalog,
      /tests\/verify-plan\.test\.ts/,
      'release-automation regression should validate the verify scope contract'
    );
    assert.match(
      verificationCatalog,
      /tests\/verify-report\.test\.ts/,
      'release-automation regression should validate the machine-readable verify report contract'
    );
    assert.match(
      verificationCatalog,
      /tests\/verify-runtime\.test\.ts/,
      'release-automation regression should validate the stage cache/runtime contract'
    );
    assert.match(
      ciRegressionHelper,
      /spawnSync\(process\.execPath, \['--import', 'tsx', '--test', testFile\]/,
      'CI regression helper should execute the suites one file at a time through process.execPath to avoid shell-specific interference'
    );
    assert.match(
      ciRegressionHelper,
      /!key\.startsWith\('npm_'\)/,
      'CI regression helper should strip npm-specific environment noise before spawning test files'
    );

    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const ciRegressionStep = (buildJob?.steps ?? []).find(
      (step) => step.name === 'Run CI regression tests'
    );

    assert.equal(
      String(ciRegressionStep?.run ?? '').includes('npm run test:ci-regression'),
      true,
      'CI workflow should run the shared regression test script even when it exports the verification report path first'
    );
  });

  test('CI change detection uses the shared verification catalog instead of inline grep policy', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const detectJob = workflow.jobs?.['detect-relevant-changes'];
    const detectStep = (detectJob?.steps ?? []).find((step) => step.id === 'filter');

    assert.ok(
      String(detectStep?.run ?? '').includes('scripts/detect-ci-relevant-changes.mjs'),
      'CI change detection should call the shared detector script'
    );
    assert.ok(
      !String(detectStep?.run ?? '').includes("grep -Eq '^(api/|react-spa/|docker/|scripts/"),
      'CI change detection should no longer duplicate path policy inline'
    );
  });

  test('smoke-tests workflow reuses the release verifier image and polls readiness before testing', () => {
    const workflowText = readText('.github/workflows/smoke-tests.yml');
    const reusableWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');

    assert.ok(
      workflowText.includes('./.github/workflows/reusable-smoke-test.yml'),
      'smoke-tests should delegate the repeated environment logic to a reusable workflow'
    );
    assert.ok(
      workflowText.includes('resolve-latest-verifier-image.mjs'),
      'smoke-tests should resolve the latest verifier image once before fan-out'
    );
    assert.ok(
      reusableWorkflowText.includes('run-smoke-in-verifier.sh'),
      'reusable smoke workflow should run smoke through the shared verifier helper'
    );
    assert.ok(
      reusableWorkflowText.includes('verifier_image:'),
      'reusable smoke workflow should accept the pre-resolved verifier image as input'
    );
    assert.ok(
      reusableWorkflowText.includes('wait-for-ready.sh'),
      'reusable smoke workflow should poll readiness via the shared helper'
    );
    assert.ok(
      !reusableWorkflowText.includes('npm ci'),
      'smoke-tests should not reinstall dependencies when the verifier image is available'
    );
  });

  test('security workflow pins Trivy and caches npm audit dependencies', () => {
    const workflowText = readText('.github/workflows/security.yml');
    const setupActionText = readText('.github/actions/setup-node/action.yml');

    assert.ok(
      workflowText.includes('aquasecurity/trivy-action@v0.35.0'),
      'security workflow should pin the Trivy action to a concrete version'
    );
    assert.ok(
      !workflowText.includes('aquasecurity/trivy-action@master'),
      'security workflow should not float on Trivy master'
    );
    assert.ok(
      workflowText.includes('./.github/actions/setup-node'),
      'security workflow should reuse the shared Node setup action'
    );
    assert.ok(
      setupActionText.includes("cache: 'npm'") || setupActionText.includes('cache: npm'),
      'shared setup-node action should cache npm installs'
    );
  });

  test('Firefox release asset workflow caches OpenPath npm installs', () => {
    const workflowText = readText('.github/workflows/firefox-release-assets.yml');
    const firefoxVersionCli = readText('scripts/firefox-release-version.mjs');
    const firefoxVersionLib = readText('scripts/lib/firefox-release-version.mjs');
    const githubActionsLib = readText('scripts/lib/github-actions.mjs');

    assert.ok(
      workflowText.includes('./.github/actions/setup-node'),
      'Firefox release asset workflow should reuse the shared Node setup action'
    );
    assert.ok(
      workflowText.includes('cache-dependency-path: upstream/openpath/package-lock.json'),
      'Firefox release asset workflow should cache OpenPath dependencies by lockfile'
    );
    assert.ok(
      firefoxVersionCli.includes("from './lib/firefox-release-version.mjs'") &&
        firefoxVersionLib.includes('export function deriveFirefoxReleaseVersionFromManifest'),
      'Firefox release versioning should keep the CLI wrapper thin over a reusable library helper'
    );
    assert.ok(
      githubActionsLib.includes('export function writeOutputs('),
      'release/workflow scripts should share GitHub Actions output helpers from a single library'
    );
  });

  test('deploy and maintenance workflows reuse the shared SSH host resolver', () => {
    const deployWorkflow = readText('.github/workflows/deploy.yml');
    const canaryWorkflow = readText('.github/workflows/windows-firefox-canary.yml');
    const cleanupWorkflow = readText('.github/workflows/cleanup-staging.yml');

    assert.ok(
      deployWorkflow.includes('bash scripts/resolve-ssh-host.sh'),
      'deploy workflow should reuse the shared SSH host resolver'
    );
    assert.ok(
      canaryWorkflow.includes('bash scripts/resolve-ssh-host.sh'),
      'windows-firefox-canary should reuse the shared SSH host resolver'
    );
    assert.ok(
      cleanupWorkflow.includes('bash scripts/resolve-ssh-host.sh'),
      'cleanup-staging should reuse the shared SSH host resolver'
    );
    assert.ok(
      !deployWorkflow.includes('DEPLOY_HOST not configured. Skipping deployment.'),
      'deploy workflow should fail loudly instead of silently skipping production deploys'
    );
    assert.ok(
      deployWorkflow.includes('verify-staging-release-state.sh'),
      'deploy workflow should delegate staging verification comparisons to a shared script'
    );
    assert.ok(
      deployWorkflow.includes('detect-windows-firefox-risk.sh'),
      'deploy workflow should delegate Windows/Firefox risk detection to a shared script'
    );
  });

  test('Deploy workflow serializes production releases', () => {
    const workflow = readWorkflow('.github/workflows/deploy.yml');
    const concurrency = workflow.concurrency;

    assert.equal(typeof concurrency, 'object', 'Deploy workflow should define object concurrency');
    assert.match(
      (concurrency as { group?: string }).group ?? '',
      /production/i,
      'Deploy workflow concurrency group should target production deploys'
    );
    assert.equal(
      (concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'],
      false,
      'Production deploys should not cancel in-progress releases'
    );
  });

  test('Deploy workflow builds release images before deployment and defines rollback', () => {
    const workflow = readWorkflow('.github/workflows/deploy.yml');
    const workflowText = readText('.github/workflows/deploy.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(
      jobs['resolve-release-images'],
      'Deploy workflow should resolve immutable release images'
    );
    assert.ok(
      (jobs['resolve-release-images']?.outputs ?? {})['payload_base64'],
      'resolve-release-images should expose the versioned deploy payload'
    );
    assert.ok(
      jobs['verify-staging-release-state'],
      'Deploy workflow should verify staging is already running the exact release candidate images'
    );
    assert.ok(jobs['deploy-production'], 'Deploy workflow should still deploy to production');
    assert.ok(jobs['smoke-test-production'], 'Deploy workflow should smoke test production');
    assert.ok(
      jobs['rollback-production'],
      'Deploy workflow should define rollback after smoke failure'
    );

    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(
      deployNeeds.includes('resolve-release-images'),
      'deploy-production should depend on resolve-release-images'
    );
    assert.ok(
      deployNeeds.includes('verify-staging-release-state'),
      'deploy-production should depend on verify-staging-release-state'
    );
    assert.ok(
      !deployNeeds.includes('release-gate-staging'),
      'deploy-production should reuse staging verification evidence instead of depending on a duplicate release-gate job'
    );

    assert.ok(
      jobs['release-evidence'],
      'Deploy workflow should publish a release-evidence summary artifact'
    );
    assert.ok(
      jobs['windows-firefox-canary'],
      'Deploy workflow should define a conditional Windows/Firefox canary gate'
    );
    assert.ok(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml',
      'Deploy workflow should delegate the canary to the dedicated reusable workflow'
    );
    assert.ok(
      !jobs['production-client-update-canary'],
      'Deploy workflow should not block completion on post-release client update canaries'
    );

    const evidenceNeeds = normalizeNeeds(jobs['release-evidence']?.needs);
    assert.ok(
      evidenceNeeds.includes('deploy-production'),
      'release-evidence should depend on deploy-production'
    );
    assert.ok(
      evidenceNeeds.includes('resolve-release-images'),
      'release-evidence should depend on resolve-release-images'
    );
    assert.ok(
      evidenceNeeds.includes('verify-staging-release-state'),
      'release-evidence should depend on verify-staging-release-state'
    );
    assert.ok(
      evidenceNeeds.includes('windows-firefox-canary'),
      'release-evidence should capture the advisory Windows/Firefox canary result'
    );
    assert.ok(
      !evidenceNeeds.includes('release-gate-staging'),
      'release-evidence should rely on staging verification evidence instead of a removed release-gate job'
    );
    assert.ok(
      evidenceNeeds.includes('smoke-test-production'),
      'release-evidence should depend on smoke-test-production'
    );
    assert.ok(
      evidenceNeeds.includes('rollback-production'),
      'release-evidence should depend on rollback-production'
    );

    const resolveSteps = jobs['resolve-release-images']?.steps ?? [];
    const resolveRun = resolveSteps.map((step) => step.run ?? '').join('\n');
    assert.ok(
      resolveRun.includes('node scripts/wait-for-release-candidate.mjs resolve-manifest'),
      'resolve-release-images should delegate manifest resolution to the shared release-candidate helper'
    );
    assert.ok(
      resolveRun.includes('--sha "$TARGET_SHA"'),
      'resolve-release-images should resolve the exact release-candidate manifest for the target SHA'
    );
    assert.ok(
      resolveRun.includes('--output-file release-images.env'),
      'resolve-release-images should persist the approved manifest for downstream jobs and evidence'
    );
    assert.ok(
      !resolveRun.includes('docker buildx imagetools inspect'),
      'resolve-release-images should not re-resolve image digests from tags during tag promotion'
    );
    assert.ok(
      resolveRun.includes('node scripts/lib/deploy-payload.mjs render-github-output'),
      'resolve-release-images should build the shared deploy payload for downstream workflow jobs'
    );

    const stagingVerificationSteps = jobs['verify-staging-release-state']?.steps ?? [];
    const stagingVerificationRun = stagingVerificationSteps
      .map((step) => step.run ?? '')
      .join('\n');
    const stagingVerificationScript = readText('scripts/verify-staging-release-state.sh');
    const releaseStateContract = readText('scripts/lib/release-state-contract.mjs');
    const releaseRiskPolicy = readText('scripts/lib/release-risk-policy.mjs');
    const releaseRiskCli = readText('scripts/release-risk-cli.mjs');
    const releaseRiskHelper = readText('scripts/lib/release-risk.sh');
    const riskDetectionScript = readText('scripts/detect-windows-firefox-risk.sh');
    assert.ok(
      stagingVerificationRun.includes('staging-verification.env'),
      'verify-staging-release-state should fetch the persisted staging verification evidence'
    );
    assert.ok(
      stagingVerificationRun.includes('production-release-state.env') &&
        stagingVerificationRun.includes('cat /opt/classroompath/release-state/current-images.env'),
      'verify-staging-release-state should read the currently deployed production release state before classifying promotion risk'
    );
    assert.ok(
      stagingVerificationRun.includes('verify-staging-release-state.sh') &&
        releaseStateContract.includes('STAGING_RELEASE_GATE_RESULT'),
      'verify-staging-release-state should require successful staging release-gate evidence'
    );
    assert.ok(
      stagingVerificationScript.includes('release-state-cli.mjs') &&
        releaseStateContract.includes('buildStagingReleaseEvidenceOutputs('),
      'verify-staging-release-state should delegate evidence output rendering to the typed release-state contract'
    );
    assert.ok(
      releaseStateContract.includes('PASS_WITH_FALLBACK'),
      'verify-staging-release-state should distinguish fallback staging smoke evidence from promotion-grade evidence'
    );
    assert.ok(
      releaseStateContract.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT') &&
        releaseStateContract.includes('STAGING_FIREFOX_POLICY_RESULT'),
      'verify-staging-release-state should enforce Windows/Firefox staging evidence for high-risk promotions'
    );
    assert.ok(
      releaseRiskHelper.includes('PRODUCTION_RELEASE_STATE_PATH') &&
        riskDetectionScript.includes('release-risk-cli.mjs') &&
        releaseRiskCli.includes('detect-github-output'),
      'verify-staging-release-state should classify risk against the real deployed production release state through the typed risk CLI'
    );
    assert.ok(
      releaseRiskPolicy.includes('openpath-api-bootstrap') &&
        releaseRiskPolicy.includes('upstream/openpath/api/src/'),
      'verify-staging-release-state should classify OpenPath API bootstrap source changes as high risk'
    );
    assert.ok(
      releaseRiskPolicy.includes('openpath-linux-runtime') &&
        releaseRiskPolicy.includes('upstream/openpath/linux/'),
      'verify-staging-release-state should classify OpenPath Linux client changes as high risk'
    );
    assert.ok(
      releaseRiskPolicy.includes('openpath-gitlink') &&
        releaseRiskPolicy.includes('upstream/openpath$'),
      'verify-staging-release-state should classify OpenPath submodule gitlink promotions as high risk'
    );
    assert.ok(
      releaseStateContract.includes('STAGING_FIREFOX_EXTENSION_ID') &&
        releaseStateContract.includes('STAGING_FIREFOX_RELEASE_VERSION') &&
        releaseStateContract.includes('STAGING_FIREFOX_METADATA_SHA256') &&
        releaseStateContract.includes('STAGING_FIREFOX_XPI_SHA256') &&
        stagingVerificationScript.includes('release-state-cli.mjs'),
      'verify-staging-release-state should expose Firefox release identity and hashes through the shared release-state helper'
    );
    assert.ok(
      workflowText.includes('STAGING_WINDOWS_FIREFOX_HIGH_RISK') &&
        workflowText.includes('STAGING_WINDOWS_FIREFOX_RISK_BASE_REF') &&
        workflowText.includes('STAGING_WINDOWS_FIREFOX_RISK_BASE_SOURCE') &&
        workflowText.includes('WINDOWS_FIREFOX_CANARY_RESULT'),
      'release-evidence should expose the high-risk flag, its production-state basis, and the pre-deploy advisory canary result'
    );
    assert.ok(
      workflowText.includes("cat > release-evidence-input.json <<'EOF'"),
      'release-evidence should serialize a single JSON input artifact before rendering markdown and JSON outputs'
    );
    assert.ok(
      workflowText.includes(
        'RELEASE_EVIDENCE_INPUT_PATH=release-evidence-input.json node scripts/write-release-evidence.mjs'
      ),
      'release-evidence should pass the serialized JSON artifact into the renderer through a single input path'
    );

    const smokeSteps = jobs['smoke-test-production']?.steps ?? [];
    const smokeRun = smokeSteps.map((step) => step.run ?? '').join('\n');
    assert.ok(
      smokeSteps.some((step) => step.uses === 'actions/checkout@v6'),
      'smoke-test-production should checkout the repository so it can run the shared readiness and verifier helper scripts'
    );
    assert.ok(
      !smokeSteps.some((step) => step.uses === 'actions/setup-node@v6'),
      'smoke-test-production should not install Node when the verifier image already contains the runtime'
    );
    assert.ok(
      workflowText.includes('CLASSROOMPATH_VERIFIER_IMAGE') &&
        readText('scripts/run-smoke-in-verifier.sh').includes('CLASSROOMPATH_VERIFIER_IMAGE'),
      'smoke-test-production should execute from the prebuilt verifier image'
    );
    assert.ok(
      smokeRun.includes('run-smoke-in-verifier.sh'),
      'smoke-test-production should reuse the shared verifier smoke helper'
    );
    assert.ok(
      readText('scripts/wait-for-ready.sh').includes('Not ready yet (attempt'),
      'smoke-test-production should poll readiness instead of sleeping for a fixed delay'
    );

    const productionDeployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(
      !productionDeployNeeds.includes('windows-firefox-canary'),
      'deploy-production should not block on the advisory Windows/Firefox canary gate'
    );
    assert.ok(
      !productionDeployNeeds.includes('production-client-update-canary'),
      'deploy-production should not wait for the post-deploy production client update canary'
    );

    const rollbackNeeds = normalizeNeeds(jobs['rollback-production']?.needs);
    assert.ok(
      !rollbackNeeds.includes('production-client-update-canary'),
      'rollback should not depend on advisory post-release client update canaries'
    );
  });

  test('Windows Firefox canary workflow exists and targets staging on a Windows runner', () => {
    const workflowText = readText('.github/workflows/windows-firefox-canary.yml');
    const workflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const jobs = workflow.jobs ?? {};
    const canaryJob = jobs['windows-firefox-canary'];
    const canarySteps = Array.isArray(canaryJob?.steps) ? canaryJob.steps : [];

    assert.ok(canaryJob, 'windows-firefox-canary workflow should define a canary job');
    assert.equal(
      canaryJob?.['runs-on'],
      'windows-latest',
      'windows-firefox-canary should run on a Windows runner'
    );
    assert.ok(
      workflowText.includes('workflow_call'),
      'windows-firefox-canary should be reusable from deploy.yml'
    );
    assert.ok(
      workflowText.includes('staging-verification.env'),
      'windows-firefox-canary should consume staging verification evidence'
    );
    assert.ok(
      canarySteps.some(
        (step) => typeof step === 'object' && step !== null && step.uses === 'actions/checkout@v6'
      ),
      'windows-firefox-canary should checkout the repository before invoking repo scripts'
    );
    assert.ok(
      workflowText.includes('policies.json'),
      'windows-firefox-canary should materialize a Firefox policies.json file'
    );
    assert.ok(
      workflowText.includes('firefox.exe') || workflowText.includes('Mozilla Firefox'),
      'windows-firefox-canary should execute Firefox Release on the runner'
    );
    assert.ok(
      workflowText.includes('openpath-firefox-extension.xpi'),
      'windows-firefox-canary should validate the staged signed Firefox XPI'
    );
    assert.ok(
      workflowText.includes('deploy-targets.mjs get staging publicUrl') &&
        workflowText.includes('/api/extensions/firefox/openpath.xpi'),
      'windows-firefox-canary should force-install the extension from the canonical public staging XPI URL'
    );
    assert.ok(
      !workflowText.includes('file:///'),
      'windows-firefox-canary should not rely on a runner-local file:// install_url that Firefox may ignore'
    );
    assert.ok(
      workflowText.includes('$firefoxCandidates = @(('),
      'windows-firefox-canary should coerce Firefox candidate paths into an array before indexing'
    );
    assert.ok(
      workflowText.includes('extensions.json'),
      'windows-firefox-canary should inspect the Firefox profile extension registry instead of relying only on debug logs'
    );
  });

  test('Windows production bootstrap canary workflow exists and exercises the live enrollment installer path', () => {
    const workflowPath = '.github/workflows/windows-production-bootstrap-canary.yml';
    const workflowText = readText(workflowPath);
    const workflow = readWorkflow(workflowPath);
    const jobs = workflow.jobs ?? {};
    const canaryJob = jobs['windows-production-bootstrap-canary'];
    const canarySteps = Array.isArray(canaryJob?.steps) ? canaryJob.steps : [];
    const canaryScriptText = readText('scripts/create-production-windows-bootstrap-canary.mjs');

    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/create-production-windows-bootstrap-canary.mjs')),
      'production bootstrap canary should ship a helper that provisions a temporary production enrollment ticket'
    );
    assert.ok(
      workflow.on?.workflow_dispatch,
      'windows-production-bootstrap-canary should be manually dispatchable'
    );
    assert.ok(canaryJob, 'windows-production-bootstrap-canary workflow should define a canary job');
    assert.equal(
      canaryJob?.['runs-on'],
      'windows-latest',
      'windows-production-bootstrap-canary should run on a Windows runner'
    );
    assert.ok(
      canarySteps.some(
        (step) =>
          typeof step === 'object' && step !== null && step.uses === './.github/actions/setup-node'
      ),
      'windows-production-bootstrap-canary should install the repo Node toolchain before provisioning a tenant'
    );
    const setupNodeStep = canarySteps.find(
      (step) => typeof step === 'object' && step !== null && step.name === 'Setup Node.js'
    );
    assert.equal(
      String(setupNodeStep?.with?.['enable-cache'] ?? ''),
      'false',
      'windows-production-bootstrap-canary should disable npm cache uploads to avoid Azure blob flake noise on short-lived GitHub-hosted runners'
    );
    assert.ok(
      workflowText.includes('create-production-windows-bootstrap-canary.mjs'),
      'windows-production-bootstrap-canary should provision a fresh production enrollment ticket through the shared helper script'
    );
    assert.ok(
      canaryScriptText.includes("'billing.createCheckout'") &&
        canaryScriptText.includes('/cp/stripe/webhook'),
      'production bootstrap canary helper should provision entitlement through the live billing checkout flow before enrollment'
    );
    assert.ok(
      !canaryScriptText.includes("'onboarding.createOrganization'"),
      'production bootstrap canary helper should not rely on the deprecated self-service organization creation path'
    );
    assert.ok(
      workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('DEPLOY_HOST') &&
        workflowText.includes('classroompath-production-release'),
      'windows-production-bootstrap-canary should retrieve the production Stripe webhook secret over the deploy SSH boundary before provisioning'
    );
    assert.ok(
      workflowText.includes('/api/enroll/') && workflowText.includes('windows.ps1'),
      'windows-production-bootstrap-canary should download the live production windows.ps1 enrollment script'
    );
    assert.ok(
      workflowText.includes('browser-policy-spec.json'),
      'windows-production-bootstrap-canary should assert that the installed browser policy spec exists after enrollment'
    );
    assert.ok(
      workflowText.includes('Update-OpenPath.ps1'),
      'windows-production-bootstrap-canary should re-run Update-OpenPath.ps1 to cover the original failure path'
    );
    assert.ok(
      workflowText.includes('Browser policy spec not found'),
      'windows-production-bootstrap-canary should fail if the original browser policy spec error reappears in logs'
    );
    assert.ok(
      workflowText.includes('disabled=True') && workflowText.includes('DEACTIVATION FLAG detected'),
      'windows-production-bootstrap-canary should fail fast when the enrolled classroom resolves to a disabled whitelist fail-open state'
    );
    assert.ok(
      workflowText.includes('policies.json') && workflowText.includes('force_installed'),
      'windows-production-bootstrap-canary should validate the Firefox enterprise policy emitted by the installed client'
    );
    assert.ok(
      workflowText.includes('extensions.json'),
      'windows-production-bootstrap-canary should inspect the Firefox profile extension registry after launching Firefox'
    );
    assert.ok(
      workflowText.includes('classroompath.eu'),
      'windows-production-bootstrap-canary should target the live production hostname'
    );
    const artifactUploadStep = canarySteps.find(
      (step) =>
        typeof step === 'object' &&
        step !== null &&
        step.name === 'Upload production bootstrap canary artifacts'
    );
    assert.equal(
      artifactUploadStep?.if,
      'always()',
      'windows-production-bootstrap-canary should always attempt to publish diagnostics'
    );
    assert.equal(
      artifactUploadStep?.['continue-on-error'],
      true,
      'windows-production-bootstrap-canary should not fail the functional canary when GitHub artifact upload flakes'
    );
  });

  test('Production client update canary exercises installed Windows and Linux self-update on GitHub runners', () => {
    const workflowPath = '.github/workflows/production-client-update-canary.yml';
    const workflowText = readText(workflowPath);
    const workflow = readWorkflow(workflowPath);
    const jobs = workflow.jobs ?? {};
    const windowsJob = jobs['windows-client-self-update-canary'];
    const linuxJob = jobs['linux-client-self-update-canary'];

    assert.ok(
      workflow.on?.workflow_run?.workflows?.includes('Deploy'),
      'production client update canary should trigger after the Deploy workflow completes'
    );
    assert.ok(
      workflow.on?.workflow_run?.types?.includes('completed'),
      'production client update canary should listen for completed Deploy workflow runs'
    );
    assert.ok(
      workflowText.includes('workflow_dispatch:'),
      'production client update canary should be manually dispatchable'
    );
    assert.ok(
      !workflowText.includes('workflow_call:'),
      'production client update canary should no longer be invoked inline from deploy.yml'
    );
    assert.equal(
      windowsJob?.['runs-on'],
      'windows-latest',
      'Windows client update canary should run on a Windows GitHub runner'
    );
    assert.equal(
      linuxJob?.['runs-on'],
      'ubuntu-latest',
      'Linux client update canary should run on a Linux GitHub runner'
    );
    assert.ok(
      workflowText.includes('create-production-windows-bootstrap-canary.mjs'),
      'both client update canaries should provision live production enrollment through the shared helper'
    );
    assert.ok(
      workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('DEPLOY_HOST') &&
        workflowText.includes('classroompath-production-release'),
      'production client update canaries should retrieve the production Stripe webhook secret over the deploy SSH boundary before provisioning'
    );
    assert.ok(
      workflowText.includes('OpenPath.ps1') && workflowText.includes('self-update --silent'),
      'Windows canary should force the installed client self-update path'
    );
    assert.ok(
      workflowText.includes('config.json') && workflowText.includes('lastAgentUpdateAt'),
      'Windows canary should validate the installed config version and update timestamp'
    );
    assert.ok(
      workflowText.includes('/api/enroll/$CLASSROOM_ID') &&
        workflowText.includes('sudo bash "$enroll_script"'),
      'Linux canary should install via the live production enrollment script'
    );
    assert.ok(
      workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'),
      'Linux canary should exercise the installed unattended update wrapper'
    );
    assert.ok(
      workflowText.includes('openpath-agent-update.timer'),
      'Linux canary should verify the unattended update timer is installed'
    );
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'"),
      'post-release Windows canary should only run after a successful Deploy workflow run'
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'"),
      'post-release Linux canary should only run after a successful Deploy workflow run'
    );
  });

  test('Release candidate workflow builds images for main before a production tag exists', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};
    const workflowText = readText('.github/workflows/release-candidate-images.yml');

    assert.ok(
      workflow.on?.push?.branches?.includes('main'),
      'release candidate workflow should trigger on pushes to main'
    );
    assert.ok(
      !workflow.on?.push?.paths,
      'release candidate workflow should not restrict push triggers by paths because every main SHA must get a release-candidate manifest for later promotion'
    );
    assert.ok(
      jobs['derive-release-image-refs'],
      'release candidate workflow should derive immutable image refs once before the parallel image builds'
    );
    const deriveOpenPathShaRun =
      jobs['derive-release-image-refs']?.steps?.find((step) => step.name === 'Resolve OpenPath SHA')
        ?.run ?? '';
    assert.ok(
      deriveOpenPathShaRun.includes('git rev-parse HEAD:upstream/openpath'),
      'release candidate workflow should derive the OpenPath SHA from the submodule gitlink even before submodules are checked out'
    );
    const deriveLinuxAgentVersionRun =
      jobs['derive-release-image-refs']?.steps?.find(
        (step) => step.name === 'Resolve OpenPath Linux agent version'
      )?.run ?? '';
    const deriveCheckout = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    assert.ok(
      deriveLinuxAgentVersionRun.includes('node scripts/resolve-openpath-linux-agent-version.mjs'),
      'release candidate workflow should resolve the OpenPath Linux agent version from the submodule and published APT metadata'
    );
    assert.equal(
      deriveCheckout?.with?.['fetch-depth'],
      0,
      'release candidate workflow should fetch full history so the OpenPath submodule exposes reachable stable release tags in CI'
    );
    assert.ok(
      jobs['build-gateway-release-candidate'],
      'release candidate workflow should build the gateway image in its own job'
    );
    assert.ok(
      jobs['build-openpath-api-release-candidate'],
      'release candidate workflow should delegate the OpenPath API image family to a reusable workflow'
    );
    assert.ok(
      jobs['build-spa-release-candidate'],
      'release candidate workflow should delegate the SPA image family to a reusable workflow'
    );
    assert.ok(
      jobs['build-migrations-release-candidate'],
      'release candidate workflow should delegate the migrations image family to a reusable workflow'
    );
    assert.ok(
      jobs['build-verifier-release-candidate'],
      'release candidate workflow should delegate the verifier image family to a reusable workflow'
    );
    assert.ok(
      jobs['resolve-openpath-firefox-release-assets'],
      'release candidate workflow should resolve prebuilt Firefox release assets before the OpenPath API image builds'
    );
    assert.ok(
      jobs['publish-release-candidate-manifest'],
      'release candidate workflow should publish a manifest after all parallel builds finish'
    );
    assert.ok(
      workflowText.includes('./.github/workflows/reusable-release-candidate-image-family.yml') &&
        readText('.github/workflows/reusable-release-candidate-image-family.yml').includes(
          './.github/actions/publish-release-candidate-manifest'
        ),
      'release candidate workflow should reuse a shared workflow for repeated multi-arch families, with manifest publication owned inside that reusable workflow'
    );

    const concurrency = workflow.concurrency;
    assert.equal(
      typeof concurrency,
      'object',
      'release candidate workflow should define object concurrency'
    );
    assert.equal(
      (concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'],
      true,
      'release candidate workflow should cancel superseded main builds'
    );

    const manifestNeeds = normalizeNeeds(jobs['publish-release-candidate-manifest']?.needs);
    assert.deepEqual(
      manifestNeeds.sort(),
      [
        'build-gateway-release-candidate',
        'build-migrations-release-candidate',
        'build-openpath-api-release-candidate',
        'build-spa-release-candidate',
        'build-verifier-release-candidate',
        'derive-release-image-refs',
      ].sort(),
      'manifest publication should wait for all parallel image builds and the shared ref-derivation job that exports the Linux agent version pin'
    );

    for (const jobName of [
      'build-gateway-release-candidate',
      'build-migrations-release-candidate',
      'build-openpath-api-release-candidate',
      'build-spa-release-candidate',
      'build-verifier-release-candidate',
    ]) {
      const jobNeeds = normalizeNeeds(jobs[jobName]?.needs);
      assert.ok(
        jobNeeds.includes('derive-release-image-refs'),
        `${jobName} should depend on the shared image-ref derivation job`
      );
      assert.ok(
        !String(jobs[jobName]?.uses ?? '').includes('actions/setup-node@v6'),
        `${jobName} should not inline Node setup once image refs are derived centrally`
      );
    }

    const firefoxPrepNeeds = normalizeNeeds(jobs['resolve-openpath-firefox-release-assets']?.needs);
    assert.deepEqual(
      firefoxPrepNeeds.sort(),
      [
        'derive-release-image-refs',
        'detect-release-candidate-components',
        'resolve-previous-release-candidate-manifest',
      ].sort(),
      'Firefox asset resolution should run after deriving refs and deciding whether a rebuild is necessary'
    );
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.uses,
      './.github/workflows/firefox-release-assets.yml',
      'Firefox asset resolution should delegate artifact preparation to the dedicated reusable workflow'
    );
    assert.ok(
      String(
        jobs['resolve-openpath-firefox-release-assets']?.with?.['build_required'] ?? ''
      ).includes('openpath_api_changed'),
      'Firefox asset resolution should pass the build-required decision into the reusable asset workflow'
    );
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.with?.['artifact_name'],
      'openpath-firefox-release-assets',
      'Firefox asset resolution should request the stable artifact name consumed by OpenPath API builds'
    );
    assert.ok(
      !workflowText.includes('wait-for-release-candidate.mjs resolve-firefox-assets'),
      'release candidate workflow should not poll a separate workflow for Firefox assets anymore'
    );
    assert.ok(
      !workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'),
      'release candidate workflow should not require AMO signing secrets directly'
    );
    const migrationsManifestNeeds = normalizeNeeds(
      jobs['build-migrations-release-candidate']?.needs
    );
    assert.deepEqual(
      migrationsManifestNeeds.sort(),
      [
        'detect-release-candidate-components',
        'derive-release-image-refs',
        'resolve-previous-release-candidate-manifest',
      ].sort(),
      'migrations manifest merge should wait for both per-architecture builds plus the reuse/build decision inputs'
    );

    const openPathManifestNeeds = normalizeNeeds(
      jobs['build-openpath-api-release-candidate']?.needs
    );
    assert.deepEqual(
      openPathManifestNeeds.sort(),
      [
        'resolve-openpath-firefox-release-assets',
        'detect-release-candidate-components',
        'derive-release-image-refs',
        'resolve-previous-release-candidate-manifest',
      ].sort(),
      'OpenPath API reusable family should wait for the reuse/build decision inputs'
    );

    assert.ok(
      normalizeNeeds(jobs['build-openpath-api-release-candidate']?.needs).includes(
        'resolve-openpath-firefox-release-assets'
      ),
      'OpenPath API reusable family should wait for the resolved Firefox release assets before building the image'
    );
    assert.equal(
      jobs['build-openpath-api-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml',
      'OpenPath API image family should be implemented via the reusable workflow'
    );
    assert.equal(
      jobs['build-openpath-api-release-candidate']?.with?.['artifact_name'],
      'openpath-firefox-release-assets',
      'OpenPath API reusable family should consume the prepared Firefox release assets'
    );

    const spaManifestNeeds = normalizeNeeds(jobs['build-spa-release-candidate']?.needs);
    assert.deepEqual(
      spaManifestNeeds.sort(),
      [
        'detect-release-candidate-components',
        'derive-release-image-refs',
        'resolve-previous-release-candidate-manifest',
      ].sort(),
      'SPA reusable family should wait for the reuse/build decision inputs'
    );

    const verifierManifestNeeds = normalizeNeeds(jobs['build-verifier-release-candidate']?.needs);
    assert.deepEqual(
      verifierManifestNeeds.sort(),
      [
        'detect-release-candidate-components',
        'derive-release-image-refs',
        'resolve-previous-release-candidate-manifest',
      ].sort(),
      'verifier reusable family should wait for the reuse/build decision inputs'
    );

    const buildImageActionText = readText(
      '.github/actions/build-release-candidate-image/action.yml'
    );
    const publishManifestActionText = readText(
      '.github/actions/publish-release-candidate-manifest/action.yml'
    );
    assert.equal(
      jobs['build-openpath-api-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml',
      'OpenPath API image family should reuse the shared workflow'
    );
    assert.equal(
      jobs['build-spa-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml',
      'SPA image family should reuse the shared workflow'
    );
    assert.equal(
      jobs['build-verifier-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml',
      'verifier image family should reuse the shared workflow'
    );
    assert.ok(
      buildImageActionText.includes('actions/download-artifact@v7') &&
        buildImageActionText.includes('docker/build-push-action@v7'),
      'the shared build action should own optional artifact download and docker build/push execution'
    );
    assert.ok(
      publishManifestActionText.includes('docker buildx imagetools create') &&
        publishManifestActionText.includes('docker buildx imagetools inspect'),
      'the shared manifest publisher action should own digest merge and immutable manifest resolution'
    );

    const publishManifestRun =
      jobs['publish-release-candidate-manifest']?.steps?.map((step) => step.run ?? '').join('\n') ??
      '';
    assert.ok(
      publishManifestRun.includes(
        'CLASSROOMPATH_MIGRATIONS_IMAGE=${{ needs.build-migrations-release-candidate.outputs.image }}'
      ) &&
        publishManifestRun.includes(
          'OPENPATH_API_IMAGE=${{ needs.build-openpath-api-release-candidate.outputs.image }}'
        ) &&
        publishManifestRun.includes(
          'CLASSROOMPATH_SPA_IMAGE=${{ needs.build-spa-release-candidate.outputs.image }}'
        ) &&
        publishManifestRun.includes(
          'CLASSROOMPATH_VERIFIER_IMAGE=${{ needs.build-verifier-release-candidate.outputs.image }}'
        ),
      'release candidate manifest should consume the shared image output exposed by each reusable image-family workflow'
    );
    assert.ok(
      publishManifestRun.includes('CLASSROOMPATH_VERIFIER_IMAGE='),
      'release candidate manifest should publish the verifier image alongside the runtime images'
    );
    assert.ok(
      publishManifestRun.includes('OPENPATH_LINUX_AGENT_VERSION='),
      'release candidate manifest should publish the pinned OpenPath Linux agent version alongside the runtime images'
    );
    assert.ok(
      jobs['resolve-previous-release-candidate-manifest'],
      'release candidate workflow should resolve the latest successful manifest so unchanged images can be reused'
    );
    assert.ok(
      jobs['detect-release-candidate-components'],
      'release candidate workflow should detect which image families actually changed before rebuilding'
    );
    assert.ok(
      workflowText.includes('steps.mode.outputs.build_required'),
      'release candidate workflow should gate expensive image builds behind per-component change detection'
    );
    assert.ok(
      readText('.github/workflows/reusable-release-candidate-image-family.yml').includes(
        'build-amd64'
      ) &&
        readText('.github/workflows/reusable-release-candidate-image-family.yml').includes(
          'build-arm64'
        ) &&
        readText('.github/workflows/reusable-release-candidate-image-family.yml').includes(
          './.github/actions/publish-release-candidate-manifest'
        ),
      'the reusable image family workflow should own the per-architecture builds and shared manifest publication'
    );
  });

  test('Firefox release asset producer workflow signs and publishes versioned artifacts', () => {
    const workflow = readWorkflow('.github/workflows/firefox-release-assets.yml');
    const workflowText = readText('.github/workflows/firefox-release-assets.yml');
    const jobs = workflow.jobs ?? {};
    const assetJob = jobs['prepare-firefox-release-assets'];

    assert.ok(
      workflow.on?.push?.branches?.includes('main'),
      'Firefox release asset workflow should trigger on pushes to main'
    );
    assert.ok(
      workflow.on?.push?.paths?.includes('upstream/openpath'),
      'Firefox release asset workflow should rerun when the OpenPath submodule pointer changes'
    );
    assert.ok(
      workflow.on?.push?.paths?.includes('docker/Dockerfile.api'),
      'Firefox release asset workflow should rerun when the API image contract changes'
    );
    assert.ok(
      workflowText.includes('workflow_dispatch:'),
      'Firefox release asset workflow should support manual rebuilds'
    );
    assert.ok(
      workflow.on?.workflow_call,
      'Firefox release asset workflow should be reusable from release-candidate-images.yml'
    );
    assert.ok(assetJob, 'Firefox release asset workflow should define a producer job');
    assert.equal(
      assetJob?.['runs-on'],
      'ubuntu-latest',
      'Firefox release assets should be produced once on ubuntu-latest'
    );

    const assetJobRun = (assetJob?.steps ?? []).map((step) => step.run ?? '').join('\n');
    assert.ok(
      (assetJob?.steps ?? []).some((step) => step.uses === './.github/actions/setup-node'),
      'Firefox release asset workflow should install Node before building/signing'
    );
    assert.ok(
      assetJobRun.includes('npm ci'),
      'Firefox release asset workflow should install OpenPath dependencies'
    );
    assert.ok(
      assetJobRun.includes('npm run build --workspace=@openpath/firefox-extension'),
      'Firefox release asset workflow should build extension dist assets before signing'
    );
    assert.ok(
      assetJobRun.includes('OPENPATH_FIREFOX_RELEASE_VERSION='),
      'Firefox release asset workflow should derive a unique signed Firefox version'
    );
    assert.ok(
      assetJobRun.includes('node scripts/firefox-release-version.mjs'),
      'Firefox release asset workflow should derive the signed Firefox version through the dedicated helper script'
    );
    assert.ok(
      assetJobRun.includes('--manifest upstream/openpath/firefox-extension/manifest.json'),
      'Firefox release asset workflow should derive the release version from the tracked Firefox manifest'
    );
    assert.ok(
      assetJobRun.includes('--run-id "$GITHUB_RUN_ID"'),
      'Firefox release asset workflow should pass the workflow run id into the Firefox release version helper'
    );
    assert.ok(
      assetJobRun.includes('--run-attempt "$GITHUB_RUN_ATTEMPT"'),
      'Firefox release asset workflow should pass the workflow run attempt into the Firefox release version helper'
    );
    assert.ok(
      !assetJobRun.includes('run_id_component="$((10#$run_id_suffix))"'),
      'Firefox release asset workflow should not re-encode AMO version semantics inline in shell'
    );
    assert.ok(
      workflowText.includes('scripts/firefox-release-version.mjs'),
      'Firefox release asset workflow should depend on the tracked Firefox release version helper'
    );
    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/firefox-release-version.mjs')),
      'Firefox release version helper should exist in scripts/'
    );
    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/lib/openpath-ci-checks.mjs')),
      'OpenPath CI gate helpers should exist as a shared script library'
    );
    assert.ok(
      readText('scripts/openpath-required-checks.mjs').includes(
        "from './lib/openpath-ci-checks.mjs'"
      ),
      'openpath-required-checks should consume the shared OpenPath CI gate helper module'
    );
    assert.ok(
      assetJobRun.includes('npm run sign:firefox-release --workspace=@openpath/firefox-extension'),
      'Firefox release asset workflow should sign the Firefox release bundle'
    );
    assert.ok(
      workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'),
      'Firefox release asset workflow should source WEB_EXT_API_KEY from GitHub Actions secrets'
    );
    assert.ok(
      workflowText.includes('WEB_EXT_API_SECRET: ${{ secrets.WEB_EXT_API_SECRET }}'),
      'Firefox release asset workflow should source WEB_EXT_API_SECRET from GitHub Actions secrets'
    );
    assert.ok(
      workflowText.includes('artifact_name="openpath-firefox-release-assets-${OPENPATH_SHA}"'),
      'Firefox release asset workflow should default to OpenPath-SHA-specific artifacts when no reusable override is provided'
    );
  });
});
