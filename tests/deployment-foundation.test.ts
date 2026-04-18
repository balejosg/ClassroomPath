import { describe, test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTextSequence, readProjectText } from './helpers/ops-contracts.ts';

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
const productionTagScriptPath = resolve(projectRoot, 'scripts/tag-production-release.sh');
const syncBillingEnvScriptPath = resolve(projectRoot, 'scripts/sync-billing-env.sh');
const resolveLatestVerifierImageLibPath = resolve(
  projectRoot,
  'scripts/lib/resolve-latest-verifier-image.mjs'
);
const releaseCandidateLibPath = resolve(projectRoot, 'scripts/lib/release-candidate.mjs');
const regressionPlanPath = resolve(projectRoot, 'scripts/lib/regression-plan.mjs');
const stagingLocalReleaseHelperPath = resolve(
  projectRoot,
  'scripts/lib/staging-deploy-local-release.sh'
);
const turboConfigPath = resolve(projectRoot, 'turbo.json');
const turboRunnerScriptPath = resolve(projectRoot, 'scripts/run-turbo.sh');

describe('Deployment foundation contracts', () => {
  const migrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations-docker.sh');
  const hostMigrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations.sh');
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const verifyFullScriptPath = resolve(projectRoot, 'scripts/verify-full.sh');
  const classroomPathPackagePath = resolve(projectRoot, 'package.json');
  const preCommitHookPath = resolve(projectRoot, '.husky/pre-commit');

  test('migration runners clean the ClassroomPath schema before db:migrate', () => {
    const dockerContent = readFileSync(migrationsScriptPath, 'utf-8');
    const hostContent = readFileSync(hostMigrationsScriptPath, 'utf-8');
    const repairStep = 'node --import tsx api/scripts/cleanup-cp-schema.ts';
    const migrateStep = 'npm run db:migrate -w @classroompath/api';

    for (const [scriptName, content] of [
      ['run-migrations-docker.sh', dockerContent],
      ['run-migrations.sh', hostContent],
    ] as const) {
      assert.ok(content.includes(repairStep), `${scriptName} should clean the schema`);
      assert.ok(
        content.indexOf(repairStep) < content.indexOf(migrateStep),
        `${scriptName} should clean the schema before db:migrate`
      );
    }
  });

  test('staging deploy validates the gateway runtime contract before migrations', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const billingSyncStep = 'bash scripts/sync-billing-env.sh "$APP_DIR/config/.env"';
    const validateStep = 'bash scripts/validate-runtime-config-docker.sh';
    const emailPreflightStep = 'bash scripts/check-email-delivery-docker.sh';
    const pushStep =
      'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"';

    assert.ok(existsSync(stagingDeployRemoteScriptPath));
    assert.ok(
      localContent.includes('STAGING_REMOTE_SCRIPT_PATH="$SCRIPT_DIR/deploy-staging-remote.sh"')
    );
    assert.ok(remoteContent.includes(billingSyncStep));
    assert.ok(remoteContent.includes(validateStep));
    assert.ok(
      remoteContent.indexOf(billingSyncStep) < remoteContent.indexOf(validateStep) &&
        remoteContent.indexOf(validateStep) < remoteContent.indexOf(pushStep)
    );
    assert.ok(
      remoteContent.includes(emailPreflightStep) &&
        remoteContent.indexOf(validateStep) < remoteContent.indexOf(emailPreflightStep) &&
        remoteContent.indexOf(emailPreflightStep) < remoteContent.indexOf(pushStep)
    );
  });

  test('staging deploy keeps billing fallback and SSH payload assembly out of the entrypoint', () => {
    const localContent = readProjectText('scripts/deploy-staging-local.sh');

    assert.ok(localContent.includes('source "$SCRIPT_DIR/lib/staging-deploy-local-runtime.sh"'));
    assert.ok(
      localContent.includes('source "$SCRIPT_DIR/lib/staging-deploy-local-release.sh"') &&
        localContent.includes('source "$SCRIPT_DIR/lib/staging-deploy-local-verify.sh"')
    );
    assert.ok(
      !localContent.includes('has_complete_billing_env() {') &&
        !localContent.includes('list_missing_billing_env() {') &&
        !localContent.includes('hydrate_billing_env_from_remote_if_needed() {') &&
        !localContent.includes('remote_assignment() {')
    );
    assert.ok(
      !localContent.includes('VERIFY_STATE_ENV_CMD="$(') &&
        !localContent.includes('REMOTE_ENV_CMD="$(')
    );
    assertTextSequence(
      localContent,
      [
        'prepare_staging_local_release_context',
        'run_staging_local_remote_deploy',
        'run_staging_local_health_checks',
        'run_staging_local_verification',
      ],
      'deploy-staging-local.sh should orchestrate staging phases in order'
    );
  });

  test('billing env sync stays mode-aware in staging and production runtime flows', () => {
    const productionRuntime = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const syncScript = readFileSync(syncBillingEnvScriptPath, 'utf-8');

    assert.ok(existsSync(syncBillingEnvScriptPath));
    assert.ok(
      productionRuntime.includes(
        'bash "$APP_DIR/scripts/sync-billing-env.sh" "$APP_DIR/config/.env"'
      )
    );
    assert.ok(
      productionRuntime.indexOf('sync-billing-env.sh') <
        productionRuntime.indexOf('validate-runtime-config-docker.sh')
    );
    assert.ok(
      syncScript.includes('CP_BILLING_MODE') &&
        syncScript.includes('remove_env_var') &&
        syncScript.includes('manual_only') &&
        syncScript.includes('when CP_BILLING_MODE=stripe')
    );
  });

  test('production compose defaults and runbook commands pin the canonical compose project name', () => {
    const compose = readFileSync(dockerComposePath, 'utf-8');
    const runbook = readFileSync(deployProductionRunbookPath, 'utf-8');

    assert.ok(compose.includes('name: ${COMPOSE_PROJECT_NAME:-classroompath-production}'));
    assert.ok(
      runbook.includes('export COMPOSE_PROJECT_NAME=classroompath-production') &&
        runbook.includes('create a second network namespace')
    );
  });

  test('verify-full keeps the release lane on full Playwright and routes policy through the typed orchestrator', () => {
    const packageJson = JSON.parse(readFileSync(classroomPathPackagePath, 'utf-8')) as {
      scripts?: Record<string, string>;
      'lint-staged'?: Record<string, string[]>;
    };
    const hook = readFileSync(preCommitHookPath, 'utf-8');
    const verifyScript = readFileSync(verifyFullOrchestratorPath, 'utf-8');
    const verifyPlan = readFileSync(verifyPlanPath, 'utf-8');
    const verifyReport = readFileSync(verifyReportPath, 'utf-8');
    const verifyPlaywright = readFileSync(verifyPlaywrightPath, 'utf-8');
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verificationCatalog = readFileSync(verificationCatalogPath, 'utf-8');
    const verifyShell = readFileSync(verifyFullScriptPath, 'utf-8');

    assert.equal(
      packageJson.scripts?.['verify:commit'],
      'VERIFY_MODE=commit bash scripts/verify-full.sh'
    );
    assert.equal(packageJson.scripts?.['verify:precommit'], 'lint-staged');
    assert.equal(packageJson.scripts?.['verify:incremental'], 'npm run verify:fast');
    assert.deepEqual(packageJson['lint-staged']?.['*.{js,ts,tsx,mjs,cjs}'], [
      'prettier --write',
      'secretlint',
    ]);
    assert.ok(!JSON.stringify(packageJson['lint-staged']).includes('eslint --fix'));
    assert.equal(
      packageJson.scripts?.['verify:release'],
      'VERIFY_MODE=release bash scripts/verify-full.sh'
    );
    assert.equal(
      packageJson.scripts?.['verify:promotion-ready'],
      'bash scripts/verify-production-promotion-ready.sh'
    );
    assert.equal(
      packageJson.scripts?.['release:production'],
      'bash scripts/tag-production-release.sh'
    );
    assert.equal(
      packageJson.scripts?.['promote:production'],
      'bash scripts/tag-production-release.sh'
    );
    assert.ok(hook.includes('npm run verify:precommit'));
    assert.ok(!hook.includes('npm run verify:commit'));
    assert.ok(!hook.includes('VERIFY_REPORT_FILE='));
    assert.equal(
      packageJson.scripts?.['test:release-automation'],
      `node --input-type=module -e "import { runReleaseAutomationRegression } from './scripts/run-ci-regression.mjs'; runReleaseAutomationRegression();"`
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:verify-fast'] ===
        'E2E_SKIP_DB_PUSH=1 npx playwright test --grep @commit-smoke'
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:commit-smoke'] ===
        'E2E_SKIP_DB_PUSH=1 npx playwright test --grep @commit-smoke'
    );
    assert.ok(
      verifyPlan.includes('verificationScope: detectVerificationScope(stagedFiles, mode)') &&
        verifyPlan.includes('releaseAutomationSafe')
    );
    assert.ok(
      verifyScript.includes("if (plan.verificationScope === 'release-automation')") &&
        verifyScript.includes("else if (plan.verificationScope === 'ops-regression')") &&
        verificationCatalog.includes(
          'Running targeted workflow/release regression instead of full product verification'
        ) &&
        verificationCatalog.includes(
          'Running deployment/workflow regression instead of full product verification'
        )
    );
    assert.ok(
      stageRunners.includes('Running commit-smoke Playwright suite...') &&
        stageRunners.includes('Running full E2E Playwright suite...')
    );
    assert.ok(
      verifyPlaywright.includes(
        'Playwright verification cannot skip tests; skipped: ${String(skipped)}'
      ) && verifyPlaywright.includes('PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath')
    );
    assert.ok(
      verifyScript.includes('createVerifyReporter(plan)') &&
        verifyReport.includes('export function createVerifyReporter(')
    );
    assert.ok(
      readFileSync(verifyReportConsumerPath, 'utf-8').includes('validateVerificationReport') &&
        readFileSync(verifyReportContractPath, 'utf-8').includes(
          'export const VERIFICATION_REPORT_VERSION = 3'
        )
    );
    assert.ok(
      verifyShell.includes('exec node --import tsx "$ROOT_DIR/scripts/verify-full.ts" "$@"')
    );
    assert.equal(packageJson.scripts?.['verify:docs'], 'node scripts/verify-docs.mjs');
    assert.ok(existsSync(verifyPlanPath));
    assert.ok(existsSync(verifyCachePath));
    assert.ok(existsSync(verifyDomainPolicyPath));
    assert.ok(existsSync(verifyStagesPath));
    assert.ok(existsSync(verifySummaryCliPath));
    assert.ok(existsSync(detectCiRelevantChangesPath));
    assert.ok(existsSync(releaseCliPath));
    assert.ok(existsSync(deployProductionContextHelperPath));
    assert.ok(existsSync(regressionPlanPath));
  });

  test('production tagging runs the promotion gate before creating and pushing the tag', () => {
    const runbook = readFileSync(deployProductionRunbookPath, 'utf-8');
    const tagScript = readFileSync(productionTagScriptPath, 'utf-8');

    assert.ok(existsSync(productionTagScriptPath));
    assert.ok(tagScript.includes('bash scripts/verify-production-promotion-ready.sh'));
    assert.ok(tagScript.includes('git tag -a "$TAG_NAME" "$main_sha" -F "$tag_message_file"'));
    assert.ok(tagScript.includes('PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir"'));
    assert.ok(tagScript.includes('git push origin "$TAG_NAME"'));
    assert.ok(tagScript.includes('HEAD must match origin/main'));
    assert.ok(runbook.includes('npm run promote:production -- v1.2.4'));
    assert.ok(!runbook.includes('git tag v1.2.4'));
  });

  test('verification runners keep coverage and Docker cleanup policy centralized', () => {
    const verifyPlan = readFileSync(verifyPlanPath, 'utf-8');
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verifyDocker = readFileSync(verifyDockerPath, 'utf-8');

    assert.ok(verifyPlan.includes('needsCoverageGate: needsApiCoverage || needsSpaCoverage'));
    assert.ok(stageRunners.includes('if (plan.needsCoverageGate) {'));
    assert.ok(stageRunners.includes('Skipping coverage gate (no changed API/SPA source files).'));
    assert.ok(stageRunners.includes('npm run verify:docs'));
    assert.ok(
      stageRunners.includes(
        'bash scripts/run-turbo.sh verify:static && npm run format:check && npm run verify:docs'
      )
    );
    assert.ok(
      verifyDocker.includes('export function discoverStaleVerifyComposeProjects(') &&
        verifyDocker.includes("['ps', '-a']") &&
        verifyDocker.includes("['network', 'ls']")
    );
    assert.ok(
      stageRunners.includes("case 'cleanup-stale-verification-projects':") &&
        stageRunners.includes("case 'cleanup-verification':")
    );
    assert.ok(verifyDocker.includes("['down', '--volumes', '--remove-orphans']"));
  });

  test('build/static verification and OpenPath bootstrap route through shared workspace helpers', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const buildScript = readFileSync(
      resolve(projectRoot, 'scripts/build-classroompath.sh'),
      'utf-8'
    );
    const stageRunners = readFileSync(verificationStageRunnersPath, 'utf-8');
    const verifyTestRunners = readFileSync(verifyTestRunnersPath, 'utf-8');
    const turboConfig = readFileSync(turboConfigPath, 'utf-8');

    assert.ok(existsSync(turboConfigPath));
    assert.ok(existsSync(turboRunnerScriptPath));
    assert.ok(
      rootPackage.scripts?.['verify:static']?.includes('scripts/run-turbo.sh verify:static')
    );
    assert.ok(buildScript.includes('scripts/run-turbo.sh build'));
    assert.ok(
      stageRunners.includes("await runtime.run('bash', ['scripts/run-turbo.sh', 'verify:static']")
    );
    assert.ok(
      turboConfig.includes('"build"') &&
        turboConfig.includes('"typecheck"') &&
        turboConfig.includes('"lint"')
    );
    assert.ok(
      verifyTestRunners.includes("join(openPathRootDir, 'node_modules/.package-lock.json')") &&
        verifyTestRunners.includes(
          "await runtime.run('npm', ['ci'], { cwd: openPathRootDir, env });"
        )
    );
    assert.ok(
      stageRunners.includes('await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);') &&
        stageRunners.includes("await runtime.run('npm', ['run', 'build']")
    );
    assert.ok(
      stageRunners.includes('derive-openpath-db-env.mjs') &&
        !stageRunners.includes("DB_HOST: 'localhost'") &&
        !stageRunners.includes("DB_PORT: '5432'")
    );
  });

  test('workspace packages and tsconfig keep the upstream OpenPath workspace contract intact', () => {
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
    ) as { version?: string };
    const upstreamApiPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'upstream/openpath/api/package.json'), 'utf-8')
    ) as { version?: string };
    const spaTsconfig = JSON.parse(
      readFileSync(resolve(projectRoot, 'react-spa/tsconfig.json'), 'utf-8')
    ) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const verifierHelper = readFileSync(resolveLatestVerifierImageLibPath, 'utf-8');
    const releaseCandidateHelper = readFileSync(releaseCandidateLibPath, 'utf-8');

    assert.equal(apiPackage.dependencies?.['@openpath/shared'], upstreamSharedPackage.version);
    assert.equal(spaPackage.dependencies?.['@openpath/shared'], upstreamSharedPackage.version);
    assert.equal(spaPackage.dependencies?.['@openpath/api'], upstreamApiPackage.version);
    assert.deepEqual(spaTsconfig.compilerOptions?.paths?.['@openpath/shared'], [
      '../upstream/openpath/shared/src',
    ]);
    assert.deepEqual(spaTsconfig.compilerOptions?.paths?.['@openpath/shared/*'], [
      '../upstream/openpath/shared/src/*',
    ]);
    assert.deepEqual(spaTsconfig.compilerOptions?.paths?.['@openpath/api'], [
      '../upstream/openpath/api/src/index.ts',
    ]);
    assert.ok(
      releaseCandidateHelper.includes(
        'export function readLatestSuccessfulReleaseCandidateManifest'
      )
    );
    assert.ok(
      verifierHelper.includes("from './release-candidate.mjs'") &&
        verifierHelper.includes('readLatestSuccessfulReleaseCandidateManifest') &&
        !verifierHelper.includes("execFileSync('gh'")
    );
  });
});
