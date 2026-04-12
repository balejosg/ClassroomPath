/**
 * ClassroomPath Deployment Infrastructure Tests
 *
 * Tests SaaS-specific deployment configurations.
 * Does NOT test OpenPath business logic (that's tested in OpenPath).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const verifyFullOrchestratorPath = resolve(projectRoot, 'scripts/verify-full.ts');
const verifyPlanPath = resolve(projectRoot, 'scripts/lib/verify-plan.ts');
const verifyReportPath = resolve(projectRoot, 'scripts/lib/verify-report.ts');
const verifyReportConsumerPath = resolve(projectRoot, 'scripts/lib/verify-report-consumer.mjs');
const verifyReportContractPath = resolve(
  projectRoot,
  'scripts/lib/verification-report-contract.mjs'
);
const verificationCatalogPath = resolve(projectRoot, 'scripts/lib/verification-catalog.mjs');
const verifyCachePath = resolve(projectRoot, 'scripts/lib/verify-cache.ts');
const verifyDomainPolicyPath = resolve(projectRoot, 'scripts/lib/verify-domain-policy.ts');
const verifyDockerPath = resolve(projectRoot, 'scripts/lib/verify-docker.ts');
const verifyPlaywrightPath = resolve(projectRoot, 'scripts/lib/verify-playwright.ts');
const verificationStageRunnersPath = resolve(
  projectRoot,
  'scripts/lib/verification-stage-runners.ts'
);
const verifyTestRunnersPath = resolve(projectRoot, 'scripts/lib/verify-test-runners.ts');
const verifyStagesPath = resolve(projectRoot, 'scripts/lib/verify-stages.ts');
const verifySummaryCliPath = resolve(projectRoot, 'scripts/print-verify-report-summary.mjs');
const detectCiRelevantChangesPath = resolve(projectRoot, 'scripts/detect-ci-relevant-changes.mjs');
const releaseCliPath = resolve(projectRoot, 'scripts/lib/release-cli.mjs');
const githubActionsArtifactsPath = resolve(projectRoot, 'scripts/lib/github-actions-artifacts.mjs');
const deployProductionContextHelperPath = resolve(
  projectRoot,
  'scripts/lib/deploy-production-context.sh'
);
const deployProductionRuntimeHelperPath = resolve(
  projectRoot,
  'scripts/lib/deploy-production-runtime.sh'
);
const dockerComposePath = resolve(projectRoot, 'docker/docker-compose.yml');
const deployProductionRunbookPath = resolve(projectRoot, 'docs/runbooks/deploy-production.md');
const syncBillingEnvScriptPath = resolve(projectRoot, 'scripts/sync-billing-env.sh');
const resolveLatestVerifierImageLibPath = resolve(
  projectRoot,
  'scripts/lib/resolve-latest-verifier-image.mjs'
);
const releaseCandidateLibPath = resolve(projectRoot, 'scripts/lib/release-candidate.mjs');
const regressionPlanPath = resolve(projectRoot, 'scripts/lib/regression-plan.mjs');
const stagingGatesHelperPath = resolve(projectRoot, 'scripts/lib/staging-gates.sh');
const turboConfigPath = resolve(projectRoot, 'turbo.json');
const turboRunnerScriptPath = resolve(projectRoot, 'scripts/run-turbo.sh');

void describe('Migration Tooling', () => {
  const migrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations-docker.sh');
  const openPathDbEnvHelperPath = resolve(projectRoot, 'scripts/derive-openpath-db-env.mjs');
  const hostMigrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations.sh');
  const migrationsImageScriptPath = resolve(projectRoot, 'scripts/run-migrations-image.sh');
  const migrationsDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.migrations');
  const gatewayDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.cp-api');
  const gatewayDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.cp-api.dockerignore');
  const spaDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.spa');
  const spaDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.spa.dockerignore');
  const verifierDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.release-verifier');
  const stagingHealthCheckScriptPath = resolve(projectRoot, 'scripts/check-staging-health.sh');
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const stagingReleaseGateScriptPath = resolve(projectRoot, 'scripts/run-staging-release-gate.sh');
  const stagingSmokeScriptPath = resolve(projectRoot, 'scripts/run-staging-smoke.sh');
  const stagingVerificationRunnerPath = resolve(projectRoot, 'scripts/run-staging-verification.sh');
  const stagingVerifyStateScriptPath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );
  const verifyFullScriptPath = resolve(projectRoot, 'scripts/verify-full.sh');
  const classroomPathPackagePath = resolve(projectRoot, 'package.json');
  const preCommitHookPath = resolve(projectRoot, '.husky/pre-commit');
  const releaseImagesScriptPath = resolve(projectRoot, 'scripts/release-images.mjs');
  const waitForReleaseCandidateScriptPath = resolve(
    projectRoot,
    'scripts/wait-for-release-candidate.mjs'
  );
  const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy.yml');
  const releaseCandidateWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/release-candidate-images.yml'
  );

  void test('ClassroomPath migrations repair legacy ClassroomPath schema before db:push', () => {
    const content = readFileSync(migrationsScriptPath, 'utf-8');
    const repairStep = 'node --import tsx api/scripts/ensure-legacy-cp-schema.ts';
    const pushStep = 'npm run db:push -w @classroompath/api';

    assert.ok(
      content.includes(repairStep),
      'run-migrations-docker.sh should repair legacy ClassroomPath schema before db:push'
    );
    assert.ok(
      content.indexOf(repairStep) < content.indexOf(pushStep),
      'legacy ClassroomPath schema repair should run before db:push'
    );
  });

  void test('host fallback migrations also repair legacy ClassroomPath schema before db:push', () => {
    const content = readFileSync(hostMigrationsScriptPath, 'utf-8');
    const repairStep = 'node --import tsx api/scripts/ensure-legacy-cp-schema.ts';
    const pushStep = 'npm run db:push -w @classroompath/api';

    assert.ok(
      content.includes(repairStep),
      'run-migrations.sh should repair legacy ClassroomPath schema before db:push'
    );
    assert.ok(
      content.indexOf(repairStep) < content.indexOf(pushStep),
      'host fallback should repair legacy ClassroomPath schema before db:push'
    );
  });

  void test('staging deploy validates the gateway runtime contract before migrations', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const billingSyncStep = 'bash scripts/sync-billing-env.sh "$APP_DIR/config/.env"';
    const validateStep = 'bash scripts/validate-runtime-config-docker.sh';
    const emailPreflightStep = 'bash scripts/check-email-delivery-docker.sh';
    const pushStep =
      'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"';

    assert.ok(
      existsSync(stagingDeployRemoteScriptPath),
      'deploy-staging-remote.sh should exist as the versioned remote deploy payload'
    );
    assert.ok(
      localContent.includes('STAGING_REMOTE_SCRIPT_PATH="$SCRIPT_DIR/deploy-staging-remote.sh"'),
      'deploy-staging-local.sh should invoke the dedicated remote deploy script'
    );
    assert.ok(
      remoteContent.includes(billingSyncStep),
      'deploy-staging-remote.sh should sync billing env before runtime validation'
    );
    assert.ok(
      remoteContent.includes(validateStep),
      'deploy-staging-remote.sh should validate runtime config before migrations'
    );
    assert.ok(
      remoteContent.indexOf(billingSyncStep) < remoteContent.indexOf(validateStep) &&
        remoteContent.indexOf(validateStep) < remoteContent.indexOf(pushStep),
      'staging billing env sync and runtime validation should happen before migrations inside the remote deploy script'
    );
    assert.ok(
      remoteContent.includes(emailPreflightStep) &&
        remoteContent.indexOf(validateStep) < remoteContent.indexOf(emailPreflightStep) &&
        remoteContent.indexOf(emailPreflightStep) < remoteContent.indexOf(pushStep),
      'transactional email preflight should happen after runtime validation and before migrations'
    );
  });

  void test('production runtime syncs the billing env block before validating runtime config', () => {
    const helper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const syncScript = readFileSync(syncBillingEnvScriptPath, 'utf-8');

    assert.ok(existsSync(syncBillingEnvScriptPath), 'scripts/sync-billing-env.sh should exist');
    assert.ok(
      helper.includes('bash "$APP_DIR/scripts/sync-billing-env.sh" "$APP_DIR/config/.env"'),
      'deploy-production-runtime.sh should sync billing env before restarting runtime'
    );
    assert.ok(
      helper.indexOf('sync-billing-env.sh') < helper.indexOf('validate-runtime-config-docker.sh'),
      'billing env sync should happen before runtime validation'
    );
    assert.ok(
      syncScript.includes('CP_BILLING_MODE') &&
        syncScript.includes('remove_env_var') &&
        syncScript.includes('manual_only') &&
        syncScript.includes('when CP_BILLING_MODE=stripe'),
      'sync-billing-env.sh should be mode-aware and prune stale Stripe vars outside stripe mode'
    );
  });

  void test('production compose defaults and runbook commands pin the canonical compose project name', () => {
    const compose = readFileSync(dockerComposePath, 'utf-8');
    const runbook = readFileSync(deployProductionRunbookPath, 'utf-8');

    assert.ok(
      compose.includes('name: ${COMPOSE_PROJECT_NAME:-classroompath-production}'),
      'docker/docker-compose.yml should default to the canonical production compose project name'
    );
    assert.ok(
      runbook.includes('export COMPOSE_PROJECT_NAME=classroompath-production') &&
        runbook.includes('create a second network namespace'),
      'deploy-production.md should require the canonical compose project name before manual docker compose commands'
    );
  });

  void test('verify-full skips coverage cleanup and gating when no API/SPA source coverage is needed', () => {
    const verifyPlan = readFileSync(verifyPlanPath, 'utf-8');
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');

    assert.ok(
      verifyPlan.includes('needsCoverageGate: needsApiCoverage || needsSpaCoverage'),
      'verify-plan.ts should track whether the changed-file coverage gate is actually needed'
    );
    assert.ok(
      stageRunners.includes('if (plan.needsCoverageGate) {'),
      'verification-stage-runners.ts should guard coverage cleanup and gating behind needsCoverageGate'
    );
    assert.ok(
      stageRunners.includes('Skipping coverage gate (no changed API/SPA source files).'),
      'verification-stage-runners.ts should report when it skips the changed-file coverage gate'
    );
  });

  void test('verify-full keeps the release lane on full Playwright while allowing a safe release-automation commit scope', () => {
    const packageJson = JSON.parse(readFileSync(classroomPathPackagePath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const hook = readFileSync(preCommitHookPath, 'utf-8');
    const verifyScript = readFileSync(verifyFullOrchestratorPath, 'utf-8');
    const verifyPlan = readFileSync(verifyPlanPath, 'utf-8');
    const verifyReport = readFileSync(verifyReportPath, 'utf-8');
    const verifyPlaywright = readFileSync(verifyPlaywrightPath, 'utf-8');
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verificationCatalog = readFileSync(verificationCatalogPath, 'utf-8');

    assert.equal(
      packageJson.scripts?.['verify:commit'],
      'VERIFY_MODE=commit bash scripts/verify-full.sh',
      'package.json should expose a dedicated fast verify:commit lane'
    );
    assert.equal(
      packageJson.scripts?.['verify:release'],
      'VERIFY_MODE=release bash scripts/verify-full.sh',
      'package.json should expose a dedicated release verify lane'
    );
    assert.ok(
      hook.includes('VERIFY_REPORT_FILE=') &&
        hook.includes('scripts/print-verify-report-summary.mjs'),
      'pre-commit should emit and summarize the machine-readable verification report around verify:commit'
    );
    assert.equal(
      packageJson.scripts?.['test:release-automation'],
      `node --input-type=module -e "import { runReleaseAutomationRegression } from './scripts/run-ci-regression.mjs'; runReleaseAutomationRegression();"`,
      'package.json should expose a dedicated release-automation regression runner'
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:verify-fast'] === 'npm run test:e2e:full',
      'the legacy fast E2E alias should resolve to the full Playwright suite'
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:commit-smoke'] === 'npm run test:e2e:full',
      'the legacy commit-smoke alias should resolve to the full Playwright suite'
    );
    assert.ok(
      verifyPlan.includes('verificationScope: detectVerificationScope(stagedFiles, mode)') &&
        verifyPlan.includes('releaseAutomationSafe'),
      'verify-plan.ts should classify a safe release automation diff through explicit domain capabilities'
    );
    assert.ok(
      verifyScript.includes("if (plan.verificationScope === 'release-automation')") &&
        verifyScript.includes("else if (plan.verificationScope === 'ops-regression')") &&
        verificationCatalog.includes(
          'Running targeted workflow/release regression instead of full product verification'
        ) &&
        verificationCatalog.includes(
          'Running deployment/workflow regression instead of full product verification'
        ),
      'verify-full.ts should route safe workflow-only diffs through release-specific scopes before falling back to full verification'
    );
    assert.ok(
      stageRunners.includes('Running full E2E Playwright suite...'),
      'verification-stage-runners.ts should keep the release/full verification lane on the full Playwright suite'
    );
    assert.ok(
      verifyPlaywright.includes(
        'Playwright verification cannot skip tests; skipped: ${String(skipped)}'
      ) && verifyPlaywright.includes('PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath'),
      'verify-playwright.ts should fail when Playwright reports skipped tests'
    );
    assert.ok(
      verifyScript.includes('createVerifyReporter(plan)') &&
        verifyReport.includes('export function createVerifyReporter('),
      'verify-full should persist a machine-readable verification report through scripts/lib/verify-report.ts'
    );
    assert.ok(
      verifyReport.includes('workspaceFingerprint') &&
        verifyReport.includes('domains: plan.domainSummary') &&
        readFileSync(verifyReportConsumerPath, 'utf-8').includes(
          'export function summarizeVerificationReport('
        ),
      'verification report creation should be paired with a reusable machine-readable consumer'
    );
    assert.ok(
      readFileSync(verifyReportConsumerPath, 'utf-8').includes('validateVerificationReport') &&
        readFileSync(verifyReportContractPath, 'utf-8').includes(
          'export const VERIFICATION_REPORT_VERSION = 3'
        ),
      'verification report consumers should validate a shared formal report contract'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'playwright.config.ts'), 'utf-8').includes(
        'PLAYWRIGHT_JSON_OUTPUT_FILE'
      ),
      'playwright.config.ts should support an auxiliary JSON reporter for verification gates'
    );
  });

  void test('latest verifier image resolution delegates release-candidate manifest lookup to the shared helper', () => {
    const verifierHelper = readFileSync(resolveLatestVerifierImageLibPath, 'utf-8');
    const releaseCandidateHelper = readFileSync(releaseCandidateLibPath, 'utf-8');

    assert.ok(
      releaseCandidateHelper.includes(
        'export function readLatestSuccessfulReleaseCandidateManifest'
      ),
      'release-candidate.mjs should expose the canonical latest-success manifest resolver'
    );
    assert.ok(
      verifierHelper.includes("from './release-candidate.mjs'") &&
        verifierHelper.includes('readLatestSuccessfulReleaseCandidateManifest'),
      'resolve-latest-verifier-image.mjs should import the shared release-candidate manifest resolver'
    );
    assert.ok(
      !verifierHelper.includes("execFileSync('gh'") &&
        !verifierHelper.includes("['run', 'download'") &&
        !verifierHelper.includes("['api', `repos/${repo}/actions/artifacts/${artifactId}/zip`]"),
      'resolve-latest-verifier-image.mjs should no longer own direct gh transport for release-candidate manifests'
    );
  });

  void test('verify-full shell entrypoint delegates policy to a typed Node orchestrator', () => {
    const verifyScript = readFileSync(verifyFullScriptPath, 'utf-8');

    assert.ok(existsSync(verifyFullOrchestratorPath), 'scripts/verify-full.ts should exist');
    assert.ok(existsSync(verifyPlanPath), 'scripts/lib/verify-plan.ts should exist');
    assert.ok(existsSync(verifyReportPath), 'scripts/lib/verify-report.ts should exist');
    assert.ok(
      existsSync(verifyReportConsumerPath),
      'scripts/lib/verify-report-consumer.mjs should exist'
    );
    assert.ok(
      existsSync(verifyReportContractPath),
      'scripts/lib/verification-report-contract.mjs should exist'
    );
    assert.ok(
      existsSync(verificationCatalogPath),
      'scripts/lib/verification-catalog.mjs should exist'
    );
    assert.ok(existsSync(verifyCachePath), 'scripts/lib/verify-cache.ts should exist');
    assert.ok(
      existsSync(verifyDomainPolicyPath),
      'scripts/lib/verify-domain-policy.ts should exist'
    );
    assert.ok(existsSync(verifyDockerPath), 'scripts/lib/verify-docker.ts should exist');
    assert.ok(existsSync(verifyPlaywrightPath), 'scripts/lib/verify-playwright.ts should exist');
    assert.ok(existsSync(verifyTestRunnersPath), 'scripts/lib/verify-test-runners.ts should exist');
    assert.ok(existsSync(verifyStagesPath), 'scripts/lib/verify-stages.ts should exist');
    assert.ok(
      existsSync(verifySummaryCliPath),
      'scripts/print-verify-report-summary.mjs should exist'
    );
    assert.ok(
      existsSync(detectCiRelevantChangesPath),
      'scripts/detect-ci-relevant-changes.mjs should exist'
    );
    assert.ok(existsSync(releaseCliPath), 'scripts/lib/release-cli.mjs should exist');
    assert.ok(
      existsSync(deployProductionContextHelperPath),
      'scripts/lib/deploy-production-context.sh should exist'
    );
    assert.ok(
      existsSync(deployProductionRuntimeHelperPath),
      'scripts/lib/deploy-production-runtime.sh should exist'
    );
    assert.ok(
      existsSync(resolveLatestVerifierImageLibPath),
      'scripts/lib/resolve-latest-verifier-image.mjs should exist'
    );
    assert.ok(existsSync(regressionPlanPath), 'scripts/lib/regression-plan.mjs should exist');
    assert.ok(
      verifyScript.includes('exec node --import tsx "$ROOT_DIR/scripts/verify-full.ts" "$@"'),
      'verify-full.sh should be a thin wrapper over the typed Node orchestrator'
    );

    const orchestrator = readFileSync(verifyFullOrchestratorPath, 'utf-8');
    const verifyPlan = readFileSync(verifyPlanPath, 'utf-8');
    const verifyStages = readFileSync(verifyStagesPath, 'utf-8');
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');

    assert.ok(
      orchestrator.includes('createVerifyPlan') &&
        verifyPlan.includes('export type VerifyPlan =') &&
        verifyPlan.includes('export function createVerifyPlan('),
      'verify-full should model verification policy through typed planning helpers in scripts/lib/verify-plan.ts'
    );
    assert.ok(
      verifyStages.includes("from './verification-stage-runners.ts'") &&
        stageRunners.includes("from './verify-playwright.ts'") &&
        stageRunners.includes("from './verify-test-runners.ts'") &&
        stageRunners.includes("from './verify-docker.ts'") &&
        stageRunners.includes("from './verification-catalog.mjs'") &&
        stageRunners.includes("from './verify-cache.ts'"),
      'verify-full should delegate orchestration to a thin verify-stages.ts wrapper over the shared stage-runner module'
    );
  });

  void test('verify-full cleans up stale compose projects so repeated local runs do not exhaust Docker subnets', () => {
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verifyDocker = readFileSync(verifyDockerPath, 'utf-8');

    assert.ok(
      verifyDocker.includes('export function discoverStaleVerifyComposeProjects(') &&
        verifyDocker.includes("['ps', '-a']") &&
        verifyDocker.includes("['network', 'ls']"),
      'verify-docker.ts should discover stale verification projects from Docker containers and networks'
    );
    assert.ok(
      stageRunners.includes("case 'cleanup-stale-verification-projects':") &&
        stageRunners.includes("case 'cleanup-verification':"),
      'verification-stage-runners.ts should clear stale verification compose state before starting PostgreSQL'
    );
    assert.ok(
      verifyDocker.includes("['down', '--volumes', '--remove-orphans']"),
      'verify-docker.ts should tear verification projects down fully instead of leaving orphaned networks behind'
    );
  });

  void test('build and static verification route through the ClassroomPath turbo pipeline', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
      workspaces?: string[];
    };
    const buildScript = readFileSync(
      resolve(projectRoot, 'scripts/build-classroompath.sh'),
      'utf-8'
    );
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const turboConfig = readFileSync(turboConfigPath, 'utf-8');

    assert.ok(existsSync(turboConfigPath), 'turbo.json should exist at the ClassroomPath root');
    assert.ok(
      existsSync(turboRunnerScriptPath),
      'scripts/run-turbo.sh should exist as the shared turbo entrypoint'
    );
    assert.ok(
      rootPackage.scripts?.['verify:static']?.includes('scripts/run-turbo.sh verify:static'),
      'package.json should expose a root verify:static script through the shared turbo runner'
    );
    assert.ok(
      buildScript.includes('scripts/run-turbo.sh build'),
      'build-classroompath.sh should delegate package builds to the shared turbo runner'
    );
    assert.ok(
      stageRunners.includes("await runtime.run('bash', ['scripts/run-turbo.sh', 'verify:static']"),
      'verification-stage-runners.ts should route static verification through the root turbo pipeline'
    );
    assert.ok(
      turboConfig.includes('"build"') &&
        turboConfig.includes('"typecheck"') &&
        turboConfig.includes('"lint"'),
      'turbo.json should define build, typecheck, and lint tasks for the workspace graph'
    );
  });

  void test('verify-full bootstraps OpenPath workspace installs before OpenPath static verification', () => {
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verifyTestRunners = readFileSync(verifyTestRunnersPath, 'utf-8');
    const bootstrapCall = 'await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);';
    const openPathStaticCall =
      "await runtime.runShell('cd upstream/openpath && npm run verify:static'";

    assert.ok(
      verifyTestRunners.includes("join(openPathRootDir, 'node_modules/.package-lock.json')"),
      'verify-test-runners.ts should treat the OpenPath npm install marker as the bootstrap contract for submodule verification'
    );
    assert.ok(
      verifyTestRunners.includes(
        "await runtime.run('npm', ['ci'], { cwd: openPathRootDir, env });"
      ),
      'verify-test-runners.ts should repair missing OpenPath workspace installs with npm ci before static verification'
    );
    assert.ok(
      stageRunners.includes(bootstrapCall) &&
        stageRunners.indexOf(bootstrapCall) < stageRunners.indexOf(openPathStaticCall),
      'verification-stage-runners.ts should bootstrap the OpenPath workspace before running OpenPath static verification'
    );
  });

  void test('verify-full bootstraps OpenPath workspace installs before ClassroomPath build orchestration', () => {
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const bootstrapCall = 'await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);';
    const buildCall = "await runtime.run('npm', ['run', 'build']";

    assert.ok(
      stageRunners.includes(bootstrapCall) &&
        stageRunners.indexOf(bootstrapCall) < stageRunners.indexOf(buildCall),
      'verification-stage-runners.ts should bootstrap the OpenPath workspace before the ClassroomPath build step that depends on turbo'
    );
  });

  void test('ClassroomPath packages declare the OpenPath shared workspace when they import it', () => {
    const apiPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'api/package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
    };
    const spaPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'react-spa/package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
    };
    const upstreamSharedPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'upstream/openpath/shared/package.json'), 'utf-8')
    ) as {
      version?: string;
    };
    const upstreamApiPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'upstream/openpath/api/package.json'), 'utf-8')
    ) as {
      version?: string;
    };

    assert.equal(
      apiPackage.dependencies?.['@openpath/shared'],
      upstreamSharedPackage.version,
      '@classroompath/api should declare @openpath/shared with the exact upstream workspace version so clean installs do not fall back to the public registry'
    );
    assert.equal(
      spaPackage.dependencies?.['@openpath/shared'],
      upstreamSharedPackage.version,
      '@classroompath/react-spa should declare @openpath/shared with the exact upstream workspace version so workspace installs match its source imports'
    );
    assert.equal(
      spaPackage.dependencies?.['@openpath/api'],
      upstreamApiPackage.version,
      '@classroompath/react-spa should declare @openpath/api with the exact upstream workspace version so clean installs pull the submodule workspace instead of the public registry'
    );
  });

  void test('ClassroomPath react-spa preserves the upstream OpenPath tsconfig path aliases it relies on', () => {
    const spaTsconfig = JSON.parse(
      readFileSync(resolve(projectRoot, 'react-spa/tsconfig.json'), 'utf-8')
    ) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };

    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/shared'],
      ['../upstream/openpath/shared/src'],
      '@classroompath/react-spa should keep the direct @openpath/shared source alias'
    );
    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/shared/*'],
      ['../upstream/openpath/shared/src/*'],
      '@classroompath/react-spa should keep the subpath @openpath/shared/* alias'
    );
    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/api'],
      ['../upstream/openpath/api/src/index.ts'],
      '@classroompath/react-spa should keep the @openpath/api alias for upstream shell typecheck'
    );
  });

  void test('staging deploy waits for the successful release-candidate manifest before source-build fallback', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(existsSync(releaseImagesScriptPath), 'release-images.mjs should exist');
    assert.ok(
      existsSync(waitForReleaseCandidateScriptPath),
      'wait-for-release-candidate.mjs should exist'
    );
    assert.ok(
      localContent.includes('node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest'),
      'deploy-staging-local.sh should wait for a successful release-candidate manifest for origin/main'
    );
    assert.ok(
      remoteContent.includes('deploy_with_release_candidates'),
      'deploy-staging-remote.sh should define a release-candidate deploy path'
    );
    assert.ok(
      remoteContent.includes('docker compose pull gateway api spa'),
      'staging remote deploy should try pulling prebuilt candidate images'
    );
    assert.ok(
      localContent.includes('STAGING_RELEASE_MANIFEST_FILE') &&
        localContent.includes('STAGING_RELEASE_MANIFEST_B64'),
      'staging deploy should resolve and forward a single release-manifest payload for the remote deploy'
    );
    assert.ok(
      localContent.includes('STAGING_RELEASE_RUN_ID') &&
        localContent.includes('STAGING_RELEASE_REPOSITORY'),
      'staging deploy should keep the release-candidate repository identity and run id alongside the manifest payload'
    );
    assert.ok(
      localContent.includes('STAGING_RELEASE_WAIT_TIMEOUT_SECONDS'),
      'staging deploy should expose a bounded wait timeout for release candidate availability'
    );
    assert.ok(
      remoteContent.includes('decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64"') &&
        remoteContent.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"'),
      'staging remote deploy should derive the release-candidate image refs from the shared manifest payload'
    );
    assert.ok(
      remoteContent.includes('decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64"') &&
        remoteContent.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"'),
      'staging remote deploy should decode and load the shared release-manifest contract before exporting runtime env'
    );
    assert.ok(
      remoteContent.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
      ),
      'staging remote deploy should persist the pinned OpenPath Linux agent version into the runtime env file before compose up'
    );
    assert.ok(
      remoteContent.includes('if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then'),
      'staging remote deploy should keep source-build as an explicit opt-in mode'
    );
    assert.ok(
      !localContent.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"'),
      'staging deploy should consume the manifest digests instead of guessing image tags locally'
    );
    assert.ok(
      !localContent.includes('Falling back to source build for staging'),
      'staging deploy should not silently fall back from release candidates to source builds'
    );
  });

  void test('staging deploy records reusable verification evidence after smoke and release gate pass', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseGateHelperContent = readFileSync(stagingReleaseGateScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingVerifyStateScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(
      existsSync(stagingVerifyStateScriptPath),
      'persist-staging-verification-remote.sh should exist as the versioned remote evidence writer'
    );
    assert.ok(
      existsSync(stagingVerificationRunnerPath),
      'run-staging-verification.sh should exist as the shared staging verification runner'
    );
    assert.ok(
      localContent.includes('STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"'),
      'deploy-staging-local.sh should default to running the staging release gate during promotion prep'
    );
    assert.ok(
      localContent.includes('STAGING_SUPPORTS_PROMOTION_EVIDENCE') &&
        localContent.includes('cannot produce promotion evidence'),
      'deploy-staging-local.sh should fail early when source-build is asked to produce promotion evidence'
    );
    assert.ok(
      existsSync(stagingReleaseGateScriptPath),
      'run-staging-release-gate.sh should exist as the versioned staging release gate helper'
    );
    assert.ok(
      releaseGateHelperContent.includes(
        'exec bash "$SCRIPT_DIR/run-staging-verification.sh" release-gate "$@"'
      ),
      'run-staging-release-gate.sh should delegate to the shared staging verification runner'
    );
    assert.ok(
      stagingGatesHelper.includes('RELEASE_GATE_URL=$canonical_staging_url'),
      'staging gate helper should keep the release gate bound to the canonical staging URL'
    );
    assert.ok(
      stagingGatesHelper.includes('RELEASE_GATE_EXPECTED_ORIGIN=$RELEASE_GATE_EXPECTED_ORIGIN'),
      'staging gate helper should pass the canonical public origin separately from the transport target'
    );
    assert.ok(
      stagingGatesHelper.includes('bash "$STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH" "$target_host"'),
      'staging gate helper should resolve canonical hosts explicitly before invoking the local runner'
    );
    assert.ok(
      runnerContent.includes('source "$SCRIPT_DIR/lib/staging-gates.sh"') &&
        stagingGatesHelper.includes('run_gate_command()'),
      'staging verification should source a shared gate runner instead of duplicating npm invocation boilerplate'
    );
    assert.ok(
      stagingGatesHelper.includes('run_gate_command smoke') &&
        stagingGatesHelper.includes('run_gate_command release-gate') &&
        stagingGatesHelper.includes('run_gate_command windows-bootstrap-gate'),
      'staging gate helper should route smoke, release-gate, and windows-bootstrap-gate through the shared gate runner'
    );
    assert.ok(
      stagingGatesHelper.includes('RELEASE_GATE_RESOLVED_ADDRESS='),
      'staging gate helper should provide the resolved release-gate address to the test runner instead of downgrading the URL'
    );
    assert.ok(
      helperContent.includes('STAGING_RELEASE_GATE_RESULT=success') ||
        localContent.includes('STAGING_GATE_RESULT="success"'),
      'staging deploy should capture a successful release-gate result'
    );
    assert.ok(
      helperContent.includes('staging-verification.env'),
      'staging deploy should persist staging-verification.env on the staging host'
    );
    assert.ok(
      helperContent.includes('STAGING_VERIFIED_GATEWAY_IMAGE'),
      'staging verification evidence should record the deployed immutable image digests'
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json'
      ),
      'staging gate helper should verify the staged Firefox release metadata inside the API container before recording evidence'
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi'
      ),
      'staging gate helper should verify the staged Firefox release XPI inside the API container before recording evidence'
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /app/runtime/browser-policy-spec.json'
      ),
      'staging gate helper should verify the shared browser policy spec inside the API container before recording evidence'
    );
    assert.ok(
      helperContent.includes(
        'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS'
      ),
      'staging verification evidence should record Firefox release artifact presence explicitly'
    );
    assert.ok(
      stagingGatesHelper.includes('run_gate_command windows-bootstrap-gate'),
      'staging gate helper should run the live Windows bootstrap gate before persisting release evidence'
    );
    assert.ok(
      stagingGatesHelper.includes('WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS='),
      'staging gate helper should provide the resolved canonical host address to the Windows bootstrap gate'
    );
    assert.ok(
      stagingGatesHelper.includes('docker exec classroompath-api printenv STRIPE_WEBHOOK_SECRET') &&
        stagingGatesHelper.includes('WINDOWS_BOOTSTRAP_GATE_STRIPE_WEBHOOK_SECRET='),
      'staging gate helper should source the Stripe webhook signing secret from the staging API container before invoking the Windows bootstrap gate'
    );
    assert.ok(
      helperContent.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT'),
      'staging verification evidence should record a successful Windows bootstrap result'
    );
    assert.ok(
      helperContent.includes('STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT'),
      'staging verification evidence should record a successful Firefox policy input result'
    );
    assert.ok(
      stagingGatesHelper.includes(
        '`${WINDOWS_BOOTSTRAP_GATE_URL}/api/extensions/firefox/openpath.xpi`'
      ) || stagingGatesHelper.includes('/api/extensions/firefox/openpath.xpi'),
      'staging gate helper should require the public Firefox XPI route used by Linux enrollments'
    );
    assert.ok(
      helperContent.includes('STAGING_FIREFOX_EXTENSION_ID=') &&
        helperContent.includes('STAGING_FIREFOX_RELEASE_VERSION=') &&
        helperContent.includes('STAGING_FIREFOX_METADATA_SHA256=') &&
        helperContent.includes('STAGING_FIREFOX_XPI_SHA256='),
      'staging verification evidence should persist Firefox release identity and hashes'
    );
    assert.ok(
      stagingGatesHelper.includes(
        'node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field extensionId'
      ) &&
        stagingGatesHelper.includes(
          'node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field version'
        ),
      'staging gate helper should own Firefox metadata parsing'
    );
    assert.ok(
      stagingGatesHelper.includes('STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE') &&
        stagingGatesHelper.includes(
          'Release-candidate staging deploys must prove the live Windows bootstrap contract'
        ),
      'shared staging gate helper should only fail staging evidence for Windows/Firefox delivery changes when the release plan explicitly requires that gate'
    );
    assert.ok(
      stagingGatesHelper.includes('docker exec classroompath-api printenv STRIPE_WEBHOOK_SECRET') &&
        (stagingGatesHelper.includes(
          'WINDOWS_BOOTSTRAP_GATE_STRIPE_WEBHOOK_SECRET="$windows_bootstrap_webhook_secret"'
        ) ||
          stagingGatesHelper.includes(
            '"WINDOWS_BOOTSTRAP_GATE_STRIPE_WEBHOOK_SECRET=$windows_bootstrap_webhook_secret"'
          )),
      'shared staging gate helper should source the live Stripe webhook secret from staging and pass it to the Windows bootstrap gate'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"'
      ),
      'deploy-staging-local.sh should reference the dedicated remote evidence writer'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      ),
      'deploy-staging-local.sh should reference the shared staging verification runner'
    );
    assert.ok(
      localContent.includes(
        'bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"'
      ),
      'deploy-staging-local.sh should delegate smoke and release-gate verification to the shared runner'
    );
    assert.ok(
      localContent.includes(
        '"${SSH_CMD[@]}" "${VERIFY_STATE_ENV_CMD}bash -s" < "$STAGING_VERIFY_STATE_SCRIPT_PATH"'
      ),
      'deploy-staging-local.sh should delegate evidence persistence to the remote helper script'
    );
  });

  void test('staging deploy delegates remote health polling to a dedicated helper', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingHealthCheckScriptPath, 'utf-8');

    assert.ok(
      existsSync(stagingHealthCheckScriptPath),
      'check-staging-health.sh should exist as the versioned staging health helper'
    );
    assert.ok(
      localContent.includes(
        'STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"'
      ),
      'deploy-staging-local.sh should reference the dedicated staging health helper'
    );
    assert.ok(
      localContent.includes(
        'bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}"'
      ),
      'deploy-staging-local.sh should delegate the remote health polling to the helper script'
    );
    assert.ok(
      helperContent.includes('curl -sf http://localhost:3000/cp/ready 2>/dev/null'),
      'staging health helper should poll gateway readiness over SSH'
    );
    assert.ok(
      helperContent.includes('curl -sf http://localhost:3000/health 2>/dev/null'),
      'staging health helper should poll API health via the gateway over SSH'
    );
  });

  void test('staging deploy delegates smoke execution and fallback resolution to a dedicated helper', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingSmokeScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(
      existsSync(stagingSmokeScriptPath),
      'run-staging-smoke.sh should exist as the versioned staging smoke helper'
    );
    assert.ok(
      helperContent.includes('exec bash "$SCRIPT_DIR/run-staging-verification.sh" smoke "$@"'),
      'run-staging-smoke.sh should delegate to the shared staging verification runner'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      ),
      'deploy-staging-local.sh should reference the shared staging verification runner for smoke checks'
    );
    assert.ok(
      stagingGatesHelper.includes('bash "$STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH" "$target_host"'),
      'staging gate helper should resolve canonical smoke and release-gate hosts explicitly before invoking the test runners'
    );
    assert.ok(
      stagingGatesHelper.includes('run_gate_command smoke'),
      'staging gate helper should execute the shared smoke entrypoint'
    );
    assert.ok(
      stagingGatesHelper.includes('SMOKE_TEST_RESOLVED_ADDRESS='),
      'staging gate helper should pass the resolved canonical host address to the smoke runner'
    );
  });

  void test('migration runner image packages the workspace migration entrypoint', () => {
    assert.ok(existsSync(migrationsDockerfilePath), 'Dockerfile.migrations should exist');
    assert.ok(existsSync(migrationsImageScriptPath), 'run-migrations-image.sh should exist');
    assert.ok(existsSync(openPathDbEnvHelperPath), 'derive-openpath-db-env.mjs should exist');

    const dockerfile = readFileSync(migrationsDockerfilePath, 'utf-8');
    const script = readFileSync(migrationsImageScriptPath, 'utf-8');

    assert.ok(
      dockerfile.includes('COPY . .'),
      'migration runner image should copy the workspace sources it migrates'
    );
    assert.ok(
      dockerfile.includes('ENTRYPOINT ["sh", "scripts/run-migrations-image.sh"]'),
      'migration runner image should execute the dedicated migrations entrypoint'
    );
    assert.ok(
      script.includes('node --import tsx api/scripts/ensure-legacy-cp-schema.ts'),
      'migration runner should repair legacy ClassroomPath schema drift before the ClassroomPath push'
    );
    assert.ok(
      script.includes('npm run db:push -w @classroompath/api'),
      'migration runner should push the ClassroomPath schema from the prebuilt image'
    );
    assert.ok(
      script.includes('npm run db:push -w @openpath/api'),
      'migration runner should push the OpenPath schema from the prebuilt image'
    );
    assert.ok(
      script.includes('node scripts/derive-openpath-db-env.mjs'),
      'migration runner should derive OpenPath DB_* env vars from the shared helper when needed'
    );
  });

  void test('gateway release image narrows its build inputs to avoid unrelated cache invalidation', () => {
    assert.ok(existsSync(gatewayDockerfilePath), 'Dockerfile.cp-api should exist');
    assert.ok(existsSync(gatewayDockerignorePath), 'Dockerfile.cp-api.dockerignore should exist');

    const dockerfile = readFileSync(gatewayDockerfilePath, 'utf-8');
    const dockerignore = readFileSync(gatewayDockerignorePath, 'utf-8');

    assert.ok(
      !dockerfile.includes('COPY . .'),
      'gateway release image should not copy the entire repository into the build stage'
    );
    assert.ok(
      dockerfile.includes('COPY api/src ./api/src'),
      'gateway release image should copy only the ClassroomPath API sources it builds'
    );
    assert.ok(
      dockerfile.includes('COPY react-spa/src ./react-spa/src'),
      'gateway release image should copy the ClassroomPath SPA sources it renders'
    );
    assert.ok(
      dockerfile.includes('COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'),
      'gateway release image should copy the upstream OpenPath SPA sources it imports'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/package*.json ./contracts/'),
      'gateway release image should copy the contracts workspace manifest required by the ClassroomPath SPA and API builds'
    );
    assert.ok(
      dockerfile.includes('COPY presenters/package*.json ./presenters/'),
      'gateway release image should copy the presenters workspace manifest required by the ClassroomPath API build'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/src ./contracts/src'),
      'gateway release image should copy the contracts workspace sources required by the ClassroomPath SPA and API builds'
    );
    assert.ok(
      dockerfile.includes('COPY presenters/src ./presenters/src'),
      'gateway release image should copy the presenters workspace sources required by the ClassroomPath API build'
    );
    assert.ok(
      dockerfile.includes(
        'COPY --from=builder /app/contracts/dist ./node_modules/@classroompath/contracts/dist'
      ),
      'gateway runtime image should restore the built contracts workspace for Node resolution'
    );
    assert.ok(
      dockerfile.includes(
        'COPY --from=builder /app/presenters/dist ./node_modules/@classroompath/presenters/dist'
      ),
      'gateway runtime image should restore the built presenters workspace for Node resolution'
    );
    assert.ok(
      dockerignore.includes('tests/**'),
      'gateway release image should ignore repo-level tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('react-spa/src/**/__tests__/**'),
      'gateway release image should ignore ClassroomPath SPA unit tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'),
      'gateway release image should ignore OpenPath SPA unit tests from its Docker context'
    );
  });

  void test('spa release image narrows its build inputs to avoid unrelated cache invalidation', () => {
    assert.ok(existsSync(spaDockerfilePath), 'Dockerfile.spa should exist');
    assert.ok(existsSync(spaDockerignorePath), 'Dockerfile.spa.dockerignore should exist');

    const dockerfile = readFileSync(spaDockerfilePath, 'utf-8');
    const dockerignore = readFileSync(spaDockerignorePath, 'utf-8');

    assert.ok(
      !dockerfile.includes('COPY . .'),
      'spa release image should not copy the entire repository into the build stage'
    );
    assert.ok(
      dockerfile.includes('COPY react-spa/src ./react-spa/src'),
      'spa release image should copy only the ClassroomPath SPA sources it builds'
    );
    assert.ok(
      dockerfile.includes('COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'),
      'spa release image should copy the upstream OpenPath SPA sources it imports'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/package*.json ./contracts/'),
      'spa release image should copy the contracts workspace manifest required by the ClassroomPath SPA build'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/src ./contracts/src'),
      'spa release image should copy the contracts workspace sources required by the ClassroomPath SPA build'
    );
    assert.ok(
      dockerignore.includes('tests/**'),
      'spa release image should ignore repo-level tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('react-spa/src/**/__tests__/**'),
      'spa release image should ignore ClassroomPath SPA unit tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'),
      'spa release image should ignore OpenPath SPA unit tests from its Docker context'
    );
  });

  void test('release verifier image packages the repo test entrypoints for tag promotion gates', () => {
    assert.ok(existsSync(verifierDockerfilePath), 'Dockerfile.release-verifier should exist');

    const dockerfile = readFileSync(verifierDockerfilePath, 'utf-8');

    assert.ok(
      dockerfile.includes('COPY . .'),
      'release verifier image should copy the repository sources needed by the gate tests'
    );
    assert.ok(
      dockerfile.includes('npm ci'),
      'release verifier image should install dependencies during the candidate build, not on the tag workflow'
    );
    assert.ok(
      dockerfile.includes('--mount=type=cache,target=/root/.npm'),
      'release verifier image should cache npm downloads across repeated candidate builds'
    );
    assert.ok(
      dockerfile.includes('tests/release-gate.test.ts') ||
        dockerfile.includes('tests/smoke.test.ts') ||
        dockerfile.includes('WORKDIR /app'),
      'release verifier image should target the repository test workspace'
    );
  });

  void test('ClassroomPath release Dockerfiles use npm cache mounts where they install dependencies', () => {
    const cases = [
      'docker/Dockerfile.cp-api',
      'docker/Dockerfile.spa',
      'docker/Dockerfile.release-verifier',
      'docker/Dockerfile.migrations',
    ];

    for (const relativePath of cases) {
      const content = readFileSync(resolve(projectRoot, relativePath), 'utf-8');
      assert.ok(
        content.includes('--mount=type=cache,target=/root/.npm'),
        `${relativePath} should cache npm downloads across repeated image builds`
      );
    }
  });

  void test('shared SSH host resolver script exists for deploy workflows', () => {
    const resolverScriptPath = resolve(projectRoot, 'scripts/resolve-ssh-host.sh');
    assert.ok(existsSync(resolverScriptPath), 'scripts/resolve-ssh-host.sh should exist');
    const content = readFileSync(resolverScriptPath, 'utf-8');
    assert.ok(content.includes('getent hosts'), 'resolver should try system DNS resolution first');
    assert.ok(content.includes('dig +short'), 'resolver should fall back to dig when needed');
    assert.ok(
      content.includes('getent ahostsv4'),
      'resolver should try IPv4-specific resolution when getent hosts is empty'
    );
    assert.ok(
      content.includes('nslookup "$HOST" 1.1.1.1'),
      'resolver should query an explicit recursive resolver when local NSS resolution is flaky'
    );
    assert.ok(
      content.includes('https://dns.google/resolve'),
      'resolver should fall back to DNS-over-HTTPS before failing'
    );
    assert.ok(
      content.includes('Resolve-DnsName') || content.includes('[System.Net.Dns]'),
      'resolver should include a Windows-compatible DNS fallback for windows-latest runners'
    );
    assert.ok(
      content.includes('command -v getent') &&
        content.includes('command -v dig') &&
        content.includes('command -v nslookup'),
      'resolver should guard optional Linux DNS helpers so missing commands do not abort Windows runners'
    );
  });

  void test('shared readiness and smoke helpers exist for reusable deployment verification', () => {
    const waitForReadyPath = resolve(projectRoot, 'scripts/wait-for-ready.sh');
    const runSmokePath = resolve(projectRoot, 'scripts/run-smoke-in-verifier.sh');

    assert.ok(existsSync(waitForReadyPath), 'scripts/wait-for-ready.sh should exist');
    assert.ok(existsSync(runSmokePath), 'scripts/run-smoke-in-verifier.sh should exist');

    const waitForReady = readFileSync(waitForReadyPath, 'utf-8');
    const runSmoke = readFileSync(runSmokePath, 'utf-8');

    assert.ok(waitForReady.includes('"ready":true'), 'readiness helper should poll for ready=true');
    assert.ok(
      runSmoke.includes('CLASSROOMPATH_VERIFIER_IMAGE'),
      'smoke helper should require the prebuilt verifier image reference'
    );
    assert.ok(
      runSmoke.includes('npm run test:smoke'),
      'smoke helper should execute the shared smoke entrypoint'
    );
  });

  void test('dockerized migration wrapper can delegate to a prebuilt migration runner image', () => {
    const content = readFileSync(migrationsScriptPath, 'utf-8');

    assert.ok(
      content.includes('--runner-image <image>'),
      'run-migrations-docker.sh should document the prebuilt runner image flag'
    );
    assert.ok(
      content.includes('RUNNER_IMAGE=""'),
      'run-migrations-docker.sh should track the optional runner image'
    );
    assert.ok(
      content.includes('"$RUNNER_IMAGE"'),
      'run-migrations-docker.sh should execute the requested prebuilt runner image'
    );
    assert.ok(
      content.includes('derive-openpath-db-env.mjs') &&
        content.includes('node /derive-openpath-db-env.mjs'),
      'run-migrations-docker.sh should derive OpenPath DB_* env vars from the shared helper before db:push'
    );
    assert.ok(
      content.includes('npm ci --silent && npm run db:push -w @openpath/api'),
      'run-migrations-docker.sh should install the full OpenPath monorepo before fallback db:push so root workspace dependencies like drizzle-orm are present'
    );
    assert.ok(
      content.indexOf('if [ -n "$RUNNER_IMAGE" ]; then') <
        content.indexOf('docker_select_image_with_fallback'),
      'run-migrations-docker.sh should skip generic node image pulls when a prebuilt runner image is provided'
    );
  });

  void test('verify-full keeps DATABASE_URL canonical and derives OpenPath DB_* env through the shared helper', () => {
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verifyDocker = readFileSync(verifyDockerPath, 'utf-8');

    assert.ok(
      verifyDocker.includes('function buildTestDatabaseUrl(testDbPort: number): string') &&
        verifyDocker.includes('DATABASE_URL: buildTestDatabaseUrl(plan.testDbPort)'),
      'verify-docker.ts should keep DATABASE_URL as the canonical test database contract'
    );
    assert.ok(
      stageRunners.includes('derive-openpath-db-env.mjs') &&
        stageRunners.includes(
          ".capture('node', [join(plan.rootDir, 'scripts/derive-openpath-db-env.mjs')]"
        ),
      'verification-stage-runners.ts should derive OpenPath DB_* compatibility env through the shared helper'
    );
    assert.ok(
      !stageRunners.includes("DB_HOST: 'localhost'") &&
        !stageRunners.includes("DB_PORT: '5432'") &&
        !stageRunners.includes('env.DB_HOST') &&
        !stageRunners.includes('env.DB_PORT'),
      'verification-stage-runners.ts should not duplicate OpenPath DB_* derivation inline'
    );
  });

  void test('production deploy uses release-candidate migrations and verifies staging state first', () => {
    const content = readFileSync(deployWorkflowPath, 'utf-8');
    const stagingVerificationScript = readFileSync(
      resolve(projectRoot, 'scripts/verify-staging-release-state.sh'),
      'utf-8'
    );
    const deployRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const deployContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const deployRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const remoteDeployScaffoldHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
      'utf-8'
    );
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );

    assert.ok(
      content.includes(
        'RELEASE_MANIFEST_B64: ${{ needs.resolve-release-images.outputs.manifest_base64 }}'
      ),
      'deploy workflow should propagate the resolved release manifest into production deployment'
    );
    assert.ok(
      content.includes('OPENPATH_LINUX_AGENT_VERSION'),
      'deploy workflow should propagate the pinned OpenPath Linux agent version into production deployment'
    );
    assert.ok(
      content.includes('verify-staging-release-state'),
      'deploy workflow should verify staging release state before production rollout'
    );
    assert.ok(
      content.includes('script_path: scripts/deploy-production-remote.sh') &&
        deployRemoteScript.includes(
          'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
        ),
      'production deploy should run migrations from the prebuilt runner image instead of npm-installing on the host'
    );
    assert.ok(
      content.includes(
        'RELEASE_MANIFEST_B64: ${{ needs.resolve-release-images.outputs.manifest_base64 }}'
      ),
      'deploy workflow should pass the resolved release manifest as a single payload into the SSH deploy boundary'
    );
    assert.ok(
      content.includes('staging-verification.env'),
      'deploy workflow should read the persisted staging verification evidence before production rollout'
    );
    assert.ok(
      content.includes('verify-staging-release-state.sh') &&
        readFileSync(resolve(projectRoot, 'scripts/lib/release-state.sh'), 'utf-8').includes(
          'STAGING_RELEASE_GATE_RESULT'
        ),
      'deploy workflow should require successful staging release-gate evidence instead of rerunning the same gate'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'scripts/lib/release-state.sh'), 'utf-8').includes(
        'STAGING_WINDOWS_BOOTSTRAP_RESULT'
      ) &&
        readFileSync(resolve(projectRoot, 'scripts/lib/release-state.sh'), 'utf-8').includes(
          'STAGING_FIREFOX_POLICY_RESULT'
        ),
      'deploy workflow should consume the Windows/Firefox staging evidence fields for promotion decisions'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'scripts/lib/release-state.sh'), 'utf-8').includes(
        'PASS_WITH_FALLBACK'
      ),
      'deploy workflow should explicitly distinguish fallback smoke evidence from production-grade evidence'
    );
    assert.ok(
      !content.includes('name: Release Gate Staging'),
      'deploy workflow should not rerun a separate staging release-gate job during production promotion'
    );
    assert.ok(
      !content.includes('docker buildx imagetools inspect'),
      'deploy workflow should not re-resolve digests from image tags during tag promotion'
    );
    assert.ok(
      !content.includes('run: sleep 30'),
      'deploy workflow should replace the fixed smoke delay with readiness polling'
    );
    assert.ok(
      deployRuntimeHelper.includes('write_release_runtime_state') &&
        deployRuntimeHelper.includes('"${OPENPATH_LINUX_AGENT_VERSION:-}"'),
      'production deploy should persist the pinned OpenPath Linux agent version in release-state metadata'
    );
    assert.ok(
      deployRuntimeHelper.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
      ),
      'production deploy should persist the pinned OpenPath Linux agent version into the runtime env file before compose up'
    );
    assert.ok(
      deployContextHelper.includes('decode_release_manifest_base64 "$RELEASE_MANIFEST_B64"') &&
        deployContextHelper.includes(
          'release_manifest_is_canonical_contract "$RELEASE_MANIFEST_FILE"'
        ) &&
        deployContextHelper.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ),
      'production deploy should load immutable image refs from the shared release manifest helper without requiring node for canonical payloads'
    );
    assert.ok(
      deployRemoteScript.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        deployRemoteScript.includes(
          'remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"'
        ) &&
        remoteDeployScaffoldHelper.includes(
          'COMMON_SH_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/common.sh")"'
        ),
      'production deploy should resolve common.sh through the shared remote bootstrap/scaffold helpers when the runner does not preserve the original script directory'
    );
    assert.ok(
      deployContextHelper.includes('classify_migration_risk() {'),
      'production deploy should keep a local migration risk classifier in shell so it does not depend on node on the target host'
    );
    assert.ok(
      deployContextHelper.includes(
        'classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"'
      ),
      'production deploy should evaluate migration risk through the local shell classifier instead of requiring node on the target host'
    );
    assert.ok(
      deployContextHelper.includes(
        'git -C "$repo_root" diff --name-only "${from_ref}..${to_ref}" --'
      ) && deployContextHelper.includes("'upstream/openpath/api/drizzle/*.sql'"),
      'production deploy should classify migration risk from git diff output covering both ClassroomPath and OpenPath SQL migrations'
    );
    assert.ok(
      deployRemoteScript.includes('upsert_env_file_var() {'),
      'production deploy should define a local env-file updater so production promotion does not depend on helper functions added after the currently deployed revision'
    );
    assert.ok(
      deployRemoteScript.includes('git submodule update --init --recursive --force') &&
        deployRemoteScript.includes('reload_deployed_common_helpers'),
      'production deploy should reload helper functions from the freshly checked out app revision before using post-checkout helpers'
    );
    assert.ok(
      rollbackRemoteScript.includes('upsert_env_file_var() {'),
      'production rollback should define a local env-file updater so rollbacks to older revisions do not depend on helper functions missing from that target revision'
    );
  });

  void test('release candidate workflow publishes a verifier image in the manifest artifact', () => {
    const content = readFileSync(releaseCandidateWorkflowPath, 'utf-8');

    assert.ok(
      content.includes('build-verifier-release-candidate'),
      'release candidate workflow should include a dedicated verifier image build job'
    );
    assert.ok(
      content.includes('docker/Dockerfile.release-verifier'),
      'release candidate workflow should build the verifier image from Dockerfile.release-verifier'
    );
    assert.ok(
      content.includes('CLASSROOMPATH_VERIFIER_IMAGE='),
      'release candidate manifest artifact should include the verifier image reference'
    );
    assert.ok(
      content.includes('OPENPATH_LINUX_AGENT_VERSION='),
      'release candidate manifest artifact should include the pinned OpenPath Linux agent version'
    );
    assert.ok(
      content.includes('OPENPATH_VERSION='),
      'release candidate manifest artifact should include the pinned installed-client OpenPath version'
    );
    assert.ok(
      content.includes('resolve-openpath-linux-agent-version.mjs'),
      'release candidate workflow should resolve the OpenPath Linux agent version automatically before publishing the manifest'
    );
  });

  void test('release manifest flows through staging and production as a single contract payload', () => {
    const stagingLocal = readFileSync(stagingDeployScriptPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf-8');
    const manifestHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest.sh');
    const manifestCompatHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest-compat.sh');
    const deployPayloadHelperPath = resolve(projectRoot, 'scripts/lib/deploy-payload.mjs');
    const manifestHelper = readFileSync(manifestHelperPath, 'utf-8');
    const manifestCompatHelper = readFileSync(manifestCompatHelperPath, 'utf-8');
    const deployPayloadHelper = readFileSync(deployPayloadHelperPath, 'utf-8');

    assert.ok(existsSync(manifestHelperPath), 'scripts/lib/release-manifest.sh should exist');
    assert.ok(
      existsSync(manifestCompatHelperPath),
      'scripts/lib/release-manifest-compat.sh should exist'
    );
    assert.ok(existsSync(deployPayloadHelperPath), 'scripts/lib/deploy-payload.mjs should exist');
    assert.ok(
      manifestHelper.includes('decode_release_manifest_base64()') &&
        manifestHelper.includes('export_release_manifest_runtime_env()') &&
        manifestHelper.includes('release_manifest_validate_contract()') &&
        manifestHelper.includes('release_manifest_is_canonical_contract()'),
      'release-manifest helper should decode, validate, detect canonical payloads, and export manifest fields from a single payload'
    );
    assert.ok(
      manifestCompatHelper.includes('release_manifest_get()') &&
        manifestCompatHelper.includes('decode_release_manifest_base64()') &&
        manifestCompatHelper.includes('release_manifest_validate_contract()') &&
        manifestCompatHelper.includes('export_release_manifest_runtime_env()'),
      'release-manifest-compat.sh should own the shared remote fallback for manifest decoding, validation, and runtime exports'
    );
    assert.ok(
      deployPayloadHelper.includes('export function buildDeployPayload') &&
        deployPayloadHelper.includes('export function encodeDeployPayloadBase64') &&
        deployPayloadHelper.includes('export function decodeDeployPayloadBase64'),
      'deploy-payload helper should own the versioned workflow-to-script deploy payload contract'
    );
    assert.ok(
      stagingLocal.includes('STAGING_RELEASE_MANIFEST_FILE=') &&
        stagingLocal.includes('--output-file "$STAGING_RELEASE_MANIFEST_FILE"'),
      'deploy-staging-local.sh should materialize the resolved release manifest to a single file'
    );
    assert.ok(
      stagingLocal.includes('STAGING_DEPLOY_PAYLOAD_B64=') &&
        stagingLocal.includes('STAGING_DEPLOY_PAYLOAD_B64="${DEPLOY_PAYLOAD_B64:-}"') &&
        stagingLocal.includes('remote_assignment STAGING_DEPLOY_PAYLOAD_B64'),
      'deploy-staging-local.sh should forward one versioned deploy payload to the remote deploy'
    );
    assert.ok(
      stagingRemote.includes('decode_deploy_payload_base64 "$STAGING_DEPLOY_PAYLOAD_B64"') &&
        stagingRemote.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        stagingRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        stagingRemote.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        stagingRemote.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"') &&
        stagingRemote.includes('ensure_staging_release_candidate_runtime_env || return 1') &&
        stagingRemote.includes(
          'log_error "Release candidate manifest did not export OpenPath runtime versions"'
        ),
      'deploy-staging-remote.sh should decode the versioned deploy payload, fall back through the shared manifest compat helper when needed, and then load the shared release manifest contract'
    );
    assert.ok(
      workflow.includes('payload_base64: ${{ steps.deploy-payload.outputs.payload_base64 }}'),
      'deploy workflow should expose the versioned deploy payload as a single output'
    );
    assert.ok(
      workflow.includes(
        'DEPLOY_PAYLOAD_B64: ${{ needs.resolve-release-images.outputs.payload_base64 }}'
      ) && workflow.includes('envs: GHCR_USERNAME,GHCR_TOKEN,DEPLOY_PAYLOAD_B64'),
      'production deploy workflow should pass one versioned deploy payload to the SSH boundary'
    );
    assert.ok(
      productionRemote.includes('decode_deploy_payload_base64 "$DEPLOY_PAYLOAD_B64"') &&
        productionRemote.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        productionRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        productionRemote.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        readFileSync(deployProductionContextHelperPath, 'utf-8').includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'ensure_production_release_candidate_runtime_env || return 1'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'RELEASE_MANIFEST_B64_FROM_PAYLOAD'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'decode_release_manifest_base64 "$release_manifest_b64" "$RELEASE_MANIFEST_FILE"'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'OPENPATH_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" openpath_version)"'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" linux_agent_version)"'
        ) &&
        readFileSync(deployProductionRuntimeHelperPath, 'utf-8').includes(
          'log_error "Release candidate manifest did not export OpenPath runtime versions"'
        ),
      'deploy-production-remote.sh should validate and load release images from the shared deploy payload contract while reusing the shared manifest compat helper at the SSH boundary'
    );
  });

  void test('release runtime helper centralizes manifest loading and runtime state writes', () => {
    const releaseRuntimeHelperPath = resolve(projectRoot, 'scripts/lib/release-runtime.sh');
    const releasePlanHelperPath = resolve(projectRoot, 'scripts/lib/release-plan.mjs');
    const releaseRuntimeHelper = readFileSync(releaseRuntimeHelperPath, 'utf-8');
    const releasePlanHelper = readFileSync(releasePlanHelperPath, 'utf-8');
    const localDeploy = readFileSync(stagingDeployScriptPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const deployContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const deployRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');

    assert.ok(existsSync(releaseRuntimeHelperPath), 'scripts/lib/release-runtime.sh should exist');
    assert.ok(existsSync(releasePlanHelperPath), 'scripts/lib/release-plan.mjs should exist');
    assert.ok(
      releaseRuntimeHelper.includes('load_release_manifest_runtime()') &&
        releaseRuntimeHelper.includes('write_release_runtime_state()'),
      'release-runtime helper should own manifest-to-env loading and current runtime state persistence'
    );
    assert.ok(
      releasePlanHelper.includes('export function buildStagingReleasePlan') &&
        releasePlanHelper.includes('export function formatStagingReleasePlanEnv'),
      'release-plan helper should own the typed staging release plan contract and shell export rendering'
    );
    assert.ok(
      localDeploy.includes('node "$SCRIPT_DIR/lib/release-plan.mjs" render-staging-env') &&
        localDeploy.includes('STAGING_RELEASE_PLAN_ENV_FILE="$(mktemp)"'),
      'deploy-staging-local.sh should derive staging image decisions from the typed release-plan helper'
    );
    assert.ok(
      stagingRemote.includes(
        'RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"'
      ) &&
        stagingRemote.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"') &&
        stagingRemote.includes('write_release_runtime_state') &&
        stagingRemote.includes('"$CURRENT_STATE_FILE"'),
      'deploy-staging-remote.sh should reuse the shared release-runtime helper'
    );
    assert.ok(
      productionRemote.includes(
        'RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"'
      ) &&
        deployContextHelper.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ) &&
        deployRuntimeHelper.includes('write_release_runtime_state') &&
        deployRuntimeHelper.includes('"$STATE_DIR/current-images.env"'),
      'deploy-production-remote.sh should reuse the shared release-runtime helper'
    );
  });

  void test('staging remote deploy executes explicit deployment phases in order', () => {
    const content = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(
      content.includes('prepare_staging_checkout()') &&
        content.includes('run_staging_runtime_validation()') &&
        content.includes('run_staging_email_delivery_preflight()') &&
        content.includes('cleanup_staging_disk_if_needed()') &&
        content.includes('run_staging_database_migrations()') &&
        content.includes('start_staging_runtime()') &&
        content.includes('wait_for_staging_runtime_readiness()'),
      'deploy-staging-remote.sh should define explicit phase functions for the remote deploy'
    );
    assert.ok(
      content.indexOf('prepare_staging_checkout') <
        content.indexOf('run_staging_runtime_validation') &&
        content.indexOf('run_staging_runtime_validation') <
          content.indexOf('run_staging_email_delivery_preflight') &&
        content.indexOf('run_staging_email_delivery_preflight') <
          content.indexOf('cleanup_staging_disk_if_needed') &&
        content.indexOf('cleanup_staging_disk_if_needed') <
          content.indexOf('run_staging_database_migrations') &&
        content.indexOf('run_staging_database_migrations') <
          content.indexOf('start_staging_runtime') &&
        content.indexOf('start_staging_runtime') <
          content.indexOf('wait_for_staging_runtime_readiness'),
      'deploy-staging-remote.sh should invoke the remote deploy phases in a stable order'
    );
    assert.ok(
      content.includes('plan_staging_runtime_deploy()') &&
        content.includes('apply_staging_runtime_deploy()') &&
        content.indexOf('plan_staging_runtime_deploy') <
          content.indexOf('apply_staging_runtime_deploy'),
      'deploy-staging-remote.sh should separate deployment planning from remote side effects'
    );
    assert.ok(
      content.includes('compose_up_force_recreate_no_build()') &&
        content.includes(
          'docker compose reported a stale container reference; retrying once after cleanup...'
        ) &&
        content.includes('compose_up_force_recreate_no_build || return 1'),
      'deploy-staging-remote.sh should retry release-candidate compose startup once after cleaning stale container references'
    );
  });

  void test('release-state helpers centralize current-image and staging-verification evidence writes', () => {
    const releaseManifestHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest.sh');
    const releaseManifestCompatHelperPath = resolve(
      projectRoot,
      'scripts/lib/release-manifest-compat.sh'
    );
    const releaseStateHelperPath = resolve(projectRoot, 'scripts/lib/release-state.sh');
    const releaseStateCompatHelperPath = resolve(
      projectRoot,
      'scripts/lib/release-state-compat.sh'
    );
    const releaseStateContractPath = resolve(projectRoot, 'scripts/lib/release-state-contract.mjs');
    const remoteDeployScaffoldHelperPath = resolve(
      projectRoot,
      'scripts/lib/remote-deploy-scaffold.sh'
    );
    const remoteHelperContractsPath = resolve(
      projectRoot,
      'scripts/lib/remote-helper-contracts.sh'
    );
    const deploymentStateHelperPath = resolve(projectRoot, 'scripts/lib/deployment-state.sh');
    const releaseRuntimeHelperPath = resolve(projectRoot, 'scripts/lib/release-runtime.sh');
    const releaseManifestHelper = readFileSync(releaseManifestHelperPath, 'utf-8');
    const releaseManifestCompatHelper = readFileSync(releaseManifestCompatHelperPath, 'utf-8');
    const releaseStateHelper = readFileSync(releaseStateHelperPath, 'utf-8');
    const releaseStateCompatHelper = readFileSync(releaseStateCompatHelperPath, 'utf-8');
    const releaseStateContract = readFileSync(releaseStateContractPath, 'utf-8');
    const remoteDeployScaffoldHelper = readFileSync(remoteDeployScaffoldHelperPath, 'utf-8');
    const remoteHelperContracts = readFileSync(remoteHelperContractsPath, 'utf-8');
    const deploymentStateHelper = readFileSync(deploymentStateHelperPath, 'utf-8');
    const releaseRuntimeHelper = readFileSync(releaseRuntimeHelperPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const persistVerification = readFileSync(
      resolve(projectRoot, 'scripts/persist-staging-verification-remote.sh'),
      'utf-8'
    );
    const verifyState = readFileSync(
      resolve(projectRoot, 'scripts/verify-staging-release-state.sh'),
      'utf-8'
    );
    const rollbackRemote = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );

    assert.ok(
      existsSync(releaseManifestHelperPath),
      'scripts/lib/release-manifest.sh should exist'
    );
    assert.ok(
      existsSync(releaseManifestCompatHelperPath),
      'scripts/lib/release-manifest-compat.sh should exist'
    );
    assert.ok(existsSync(releaseStateHelperPath), 'scripts/lib/release-state.sh should exist');
    assert.ok(
      existsSync(releaseStateCompatHelperPath),
      'scripts/lib/release-state-compat.sh should exist'
    );
    assert.ok(
      existsSync(releaseStateContractPath),
      'scripts/lib/release-state-contract.mjs should exist'
    );
    assert.ok(
      existsSync(remoteDeployScaffoldHelperPath),
      'scripts/lib/remote-deploy-scaffold.sh should exist'
    );
    assert.ok(
      existsSync(deploymentStateHelperPath),
      'scripts/lib/deployment-state.sh should exist'
    );
    assert.ok(existsSync(releaseRuntimeHelperPath), 'scripts/lib/release-runtime.sh should exist');
    assert.ok(
      existsSync(remoteHelperContractsPath),
      'scripts/lib/remote-helper-contracts.sh should exist'
    );
    assert.ok(
      releaseStateHelper.includes('load_release_state_env()') &&
        releaseStateHelper.includes('write_release_state_snapshot()') &&
        releaseStateHelper.includes('write_current_release_state()') &&
        releaseStateHelper.includes('write_deploy_context_state()') &&
        releaseStateHelper.includes('write_staging_verification_state()') &&
        !releaseStateHelper.includes('release_state_fields()') &&
        releaseStateHelper.includes('release_state_cli_available()') &&
        releaseStateHelper.includes('cli_cmd=(env)') &&
        releaseStateHelper.includes('list-fields') &&
        releaseStateHelper.includes('"$(release_state_cli_path)"'),
      'release-state helper should resolve snapshot fields from the typed release-state CLI and delegate snapshot writes without keeping local field lists'
    );
    assert.ok(
      releaseStateCompatHelper.includes('write_release_state_snapshot_compat()') &&
        releaseStateCompatHelper.includes('list-fields') &&
        releaseStateCompatHelper.includes('"$(release_state_cli_path)"'),
      'release-state-compat.sh should be the shared shell fallback for snapshot serialization when the typed helper contract is unavailable'
    );
    assert.ok(
      releaseStateContract.includes('RELEASE_STATE_SNAPSHOT_DEFINITIONS') &&
        releaseStateContract.includes('validateCurrentReleaseState(') &&
        releaseStateContract.includes('validateStagingVerification(') &&
        releaseStateContract.includes('buildStagingReleaseEvidenceOutputs('),
      'release-state contract should own typed snapshot schemas, validation, and workflow output rendering'
    );
    assert.ok(
      remoteDeployScaffoldHelper.includes('remote_deploy_init_base_helper_paths()') &&
        remoteDeployScaffoldHelper.includes('remote_deploy_init_production_helper_paths()') &&
        remoteDeployScaffoldHelper.includes('remote_deploy_reload_checked_out_helpers()') &&
        remoteDeployScaffoldHelper.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        remoteDeployScaffoldHelper.includes('RELEASE_STATE_COMPAT_HELPER_PATH'),
      'remote deploy scaffold helper should centralize helper-path initialization and post-checkout helper reloads for streamed remote deploys, including release-manifest and release-state compatibility fallbacks'
    );
    assert.ok(
      remoteHelperContracts.includes('remote_helper_path_supports_all()') &&
        remoteHelperContracts.includes('remote_helper_contract_version()') &&
        remoteHelperContracts.includes('remote_helper_contract_version_at_least()') &&
        remoteHelperContracts.includes('RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes('RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes(
          'RELEASE_STATE_STAGING_VERIFICATION_MIN_CONTRACT_VERSION='
        ) &&
        remoteHelperContracts.includes('DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes('RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes('release_manifest_compat_helper_supports_contract()') &&
        remoteHelperContracts.includes(
          'release_state_helper_supports_staging_verification_contract()'
        ) &&
        remoteHelperContracts.includes('refresh_deployed_release_helpers()'),
      'remote-helper-contracts should centralize version-first post-checkout helper compatibility checks for streamed remote deploys'
    );
    assert.ok(
      deploymentStateHelper.includes('deployment_state_init_paths()') &&
        deploymentStateHelper.includes('DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION=') &&
        deploymentStateHelper.includes('deployment_state_capture_previous_release()') &&
        deploymentStateHelper.includes('deployment_state_activate_previous_release()'),
      'deployment-state helper should own current/previous/context rollback state transitions'
    );
    assert.ok(
      releaseManifestHelper.includes('RELEASE_MANIFEST_HELPER_CONTRACT_VERSION=') &&
        releaseManifestCompatHelper.includes('RELEASE_MANIFEST_COMPAT_HELPER_CONTRACT_VERSION=') &&
        releaseStateHelper.includes('RELEASE_STATE_HELPER_CONTRACT_VERSION=') &&
        releaseStateCompatHelper.includes('RELEASE_STATE_COMPAT_HELPER_CONTRACT_VERSION=') &&
        releaseRuntimeHelper.includes('RELEASE_RUNTIME_HELPER_CONTRACT_VERSION='),
      'remote deploy helpers should publish explicit numeric contract versions for version-first compatibility checks'
    );
    assert.ok(
      stagingRemote.includes('RELEASE_STATE_HELPER_PATH') &&
        stagingRemote.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        stagingRemote.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        stagingRemote.includes('remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"') &&
        stagingRemote.includes(
          'remote_deploy_reload_checked_out_helpers "$APP_DIR/scripts/lib/common.sh"'
        ) &&
        stagingRemote.includes('release_manifest_helper_supports_contract()') &&
        stagingRemote.includes('release_state_helper_supports_runtime_contract()') &&
        stagingRemote.includes('refresh_deployed_release_helpers') &&
        stagingRemote.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        stagingRemote.includes('RELEASE_STATE_COMPAT_HELPER_PATH') &&
        remoteHelperContracts.includes('remote_helper_path_supports_all()') &&
        remoteHelperContracts.includes('release_manifest_compat_helper_supports_contract()') &&
        remoteHelperContracts.includes('release_state_helper_supports_runtime_contract()') &&
        !stagingRemote.includes('release_manifest_get() {') &&
        !stagingRemote.includes('release_manifest_validate_contract() {') &&
        stagingRemote.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        !stagingRemote.includes('write_current_release_state() {') &&
        !stagingRemote.includes('write_deploy_context_state() {') &&
        stagingRemote.includes('write_release_state_snapshot_compat') &&
        stagingRemote.includes('write_release_runtime_state'),
      'deploy-staging-remote.sh should use the shared remote deploy scaffold, reuse the shared manifest and release-state compatibility helpers when needed, reject stale contracts, and reload refreshed helpers after checkout'
    );
    assert.ok(
      productionRemote.includes('RELEASE_STATE_HELPER_PATH') &&
        productionRemote.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        productionRemote.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        productionRemote.includes(
          'remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"'
        ) &&
        productionRemote.includes(
          'remote_deploy_init_production_helper_paths "$SCRIPT_DIR" "$APP_DIR"'
        ) &&
        productionRemote.includes(
          'remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"'
        ) &&
        productionRemote.includes('release_manifest_helper_supports_contract()') &&
        productionRemote.includes('release_state_helper_supports_runtime_contract()') &&
        productionRemote.includes('refresh_deployed_release_helpers') &&
        productionRemote.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        productionRemote.includes('RELEASE_STATE_COMPAT_HELPER_PATH') &&
        remoteHelperContracts.includes('remote_helper_path_supports_all()') &&
        remoteHelperContracts.includes('release_manifest_compat_helper_supports_contract()') &&
        remoteHelperContracts.includes('release_state_helper_supports_runtime_contract()') &&
        !productionRemote.includes('release_manifest_get() {') &&
        !productionRemote.includes('release_manifest_validate_contract() {') &&
        productionRemote.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        !productionRemote.includes('write_current_release_state() {') &&
        !productionRemote.includes('write_deploy_context_state() {') &&
        productionRemote.includes('write_release_state_snapshot_compat') &&
        productionRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        productionRemote.includes('deployment_state_helper_supports_contract()') &&
        remoteHelperContracts.includes('deployment_state_helper_supports_contract()') &&
        productionRemote.includes('deployment_state_capture_previous_release') &&
        productionRemote.includes('write_release_runtime_state'),
      'deploy-production-remote.sh should use the shared remote deploy scaffold, reuse the shared manifest/release-state/deployment-state helpers, reject stale contracts, and reload refreshed helpers after checkout'
    );
    assert.ok(
      persistVerification.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"') &&
        persistVerification.includes('SCRIPT_DIR="$APP_DIR/scripts"') &&
        persistVerification.includes('RELEASE_STATE_HELPER_PATH') &&
        persistVerification.includes('RELEASE_STATE_COMPAT_HELPER_PATH') &&
        persistVerification.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        persistVerification.includes(
          'release_state_helper_supports_staging_verification_contract()'
        ) &&
        remoteHelperContracts.includes(
          'release_state_helper_supports_staging_verification_contract()'
        ) &&
        persistVerification.includes('write_release_state_snapshot_compat') &&
        persistVerification.includes('STAGING_VERIFICATION_RUNNER_PATH') &&
        persistVerification.includes('persist-evidence'),
      'persist-staging-verification-remote.sh should reject stale release-state helpers, fall back through the shared release-state compatibility helper, and then delegate persistence to the shared staging verification runner'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf-8').includes(
        'remote_assignment STAGING_SMOKE_RESULT "$STAGING_SMOKE_RESULT"'
      ) &&
        readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf-8').includes(
          'remote_assignment STAGING_RELEASE_GATE_RESULT "$STAGING_RELEASE_GATE_RESULT"'
        ),
      'deploy-staging-local.sh should forward smoke and release-gate evidence to the remote persistence writer'
    );
    assert.ok(
      rollbackRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        rollbackRemote.includes('deployment_state_activate_previous_release') &&
        rollbackRemote.includes('deployment_state_load_context') &&
        rollbackRemote.includes('ROLLBACK_RELEASE_APP_SHA="$APP_SHA"') &&
        rollbackRemote.includes('APP_SHA="$ROLLBACK_RELEASE_APP_SHA"'),
      'rollback-production-remote.sh should consume shared rollback metadata without letting deploy-context values override the previous release SHA'
    );
    assert.ok(
      verifyState.includes('release-state-cli.mjs') &&
        verifyState.includes('--current ./staging-release-state.env') &&
        verifyState.includes('--verification ./staging-verification.env') &&
        verifyState.includes('--high-risk "${HIGH_RISK:-false}"'),
      'verify-staging-release-state.sh should delegate staging release-state validation to the typed Node CLI'
    );
  });

  void test('production remote deploy executes explicit deployment phases in order', () => {
    const content = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const contextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const runtimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const productionPhaseSequence = [
      'run_remote_deploy_phases \\',
      '  load_production_deploy_payload \\',
      '  prepare_production_checkout \\',
      '  load_production_release_manifest \\',
      '  classify_production_migration_risk \\',
      '  cleanup_production_disk_if_needed \\',
      '  run_production_database_migrations \\',
      '  start_production_runtime \\',
      '  wait_for_production_runtime_readiness',
    ].join('\n');
    const productionPhaseFunctions = [
      'prepare_production_checkout',
      'load_production_release_manifest',
      'classify_production_migration_risk',
      'cleanup_production_disk_if_needed',
      'run_production_database_migrations',
      'start_production_runtime',
      'wait_for_production_runtime_readiness',
    ];

    assert.ok(
      content.includes('DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH') &&
        content.includes('DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH') &&
        content.includes('source "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH"') &&
        content.includes('source "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH"'),
      'deploy-production-remote.sh should source dedicated production deploy helper modules'
    );
    assert.ok(
      contextHelper.includes('classify_production_migration_risk_impl()') &&
        contextHelper.includes('load_production_release_manifest_impl()') &&
        runtimeHelper.includes('plan_production_runtime_deploy_impl()') &&
        runtimeHelper.includes('wait_for_production_runtime_readiness_impl()'),
      'production deploy helpers should own the extracted context/runtime phases'
    );

    assert.ok(
      productionPhaseFunctions.every((phase) => content.includes(`${phase}()`)),
      'deploy-production-remote.sh should define explicit phase functions for the remote production deploy'
    );
    assert.ok(
      content.includes(productionPhaseSequence),
      'deploy-production-remote.sh should invoke the remote production phases in a stable order'
    );
    assert.ok(
      content.includes('bash scripts/check-email-delivery-docker.sh') &&
        content.indexOf('bash scripts/check-email-delivery-docker.sh') <
          content.indexOf(
            'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
          ),
      'production deploy should run transactional email preflight before migrations'
    );
    assert.ok(
      content.includes('plan_production_runtime_deploy()') &&
        content.includes('apply_production_runtime_deploy()') &&
        content.indexOf('plan_production_runtime_deploy') <
          content.indexOf('apply_production_runtime_deploy') &&
        runtimeHelper.includes('cleanup_production_disk_if_needed'),
      'deploy-production-remote.sh should separate deployment planning from remote side effects and re-check disk pressure before pulling immutable runtime images'
    );
  });
});
