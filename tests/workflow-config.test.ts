import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  'runs-on'?: string | string[];
  uses?: string;
  steps?: Array<{
    name?: string;
    id?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
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
        required: ['actions/checkout@v6', 'actions/setup-node@v6'],
        forbidden: ['actions/checkout@v4', 'actions/setup-node@v4'],
      },
      {
        relativePath: '.github/workflows/sync-openpath.yml',
        required: ['actions/checkout@v6', 'actions/setup-node@v6'],
        forbidden: ['actions/checkout@v4', 'actions/setup-node@v4'],
      },
      {
        relativePath: '.github/workflows/verify-trailers.yml',
        required: ['actions/checkout@v6'],
        forbidden: ['actions/checkout@v4'],
      },
      {
        relativePath: '.github/workflows/release-candidate-images.yml',
        required: [
          'docker/setup-buildx-action@v4',
          'docker/login-action@v4',
          'docker/build-push-action@v7',
        ],
        forbidden: [
          'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
          'docker/setup-buildx-action@v3',
          'docker/login-action@v3',
          'docker/build-push-action@v6',
        ],
      },
      {
        relativePath: '.github/workflows/deploy.yml',
        required: ['docker/login-action@v4'],
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

  test('CI regression command is routed through package.json and includes agent doc drift checks', () => {
    const packageJson = readPackageJson();
    const ciRegression = packageJson.scripts?.['test:ci-regression'] ?? '';
    assert.match(
      ciRegression,
      /tests\/agent-docs-consistency\.test\.ts/,
      'package.json should include the agent docs consistency suite in CI regression tests'
    );

    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const ciRegressionStep = (buildJob?.steps ?? []).find(
      (step) => step.name === 'Run CI regression tests'
    );

    assert.equal(
      ciRegressionStep?.run,
      'npm run test:ci-regression',
      'CI workflow should run the shared regression test script'
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
    assert.equal(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml',
      'Deploy workflow should delegate the canary to the dedicated reusable workflow'
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

    const stagingVerificationSteps = jobs['verify-staging-release-state']?.steps ?? [];
    const stagingVerificationRun = stagingVerificationSteps
      .map((step) => step.run ?? '')
      .join('\n');
    assert.ok(
      stagingVerificationRun.includes('staging-verification.env'),
      'verify-staging-release-state should fetch the persisted staging verification evidence'
    );
    assert.ok(
      stagingVerificationRun.includes('STAGING_RELEASE_GATE_RESULT'),
      'verify-staging-release-state should require successful staging release-gate evidence'
    );
    assert.ok(
      stagingVerificationRun.includes('staging_smoke_result='),
      'verify-staging-release-state should expose staging smoke evidence to downstream jobs'
    );
    assert.ok(
      stagingVerificationRun.includes('PASS_WITH_FALLBACK'),
      'verify-staging-release-state should distinguish fallback staging smoke evidence from promotion-grade evidence'
    );
    assert.ok(
      stagingVerificationRun.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT') &&
        stagingVerificationRun.includes('STAGING_FIREFOX_POLICY_RESULT'),
      'verify-staging-release-state should enforce Windows/Firefox staging evidence for high-risk promotions'
    );
    assert.ok(
      stagingVerificationRun.includes('upstream/openpath/api/src/'),
      'verify-staging-release-state should classify OpenPath API bootstrap source changes as high risk'
    );
    assert.ok(
      stagingVerificationRun.includes('STAGING_FIREFOX_EXTENSION_ID') &&
        stagingVerificationRun.includes('STAGING_FIREFOX_RELEASE_VERSION') &&
        stagingVerificationRun.includes('STAGING_FIREFOX_METADATA_SHA256') &&
        stagingVerificationRun.includes('STAGING_FIREFOX_XPI_SHA256'),
      'verify-staging-release-state should expose Firefox release identity and hashes to downstream jobs'
    );
    assert.ok(
      workflowText.includes('STAGING_WINDOWS_FIREFOX_HIGH_RISK') &&
        workflowText.includes('WINDOWS_FIREFOX_CANARY_RESULT'),
      'release-evidence should expose the high-risk flag and advisory canary result'
    );

    const smokeSteps = jobs['smoke-test-production']?.steps ?? [];
    const smokeRun = smokeSteps.map((step) => step.run ?? '').join('\n');
    assert.ok(
      !smokeSteps.some((step) => step.uses === 'actions/checkout@v6'),
      'smoke-test-production should not checkout the repository when the verifier image already contains the tests'
    );
    assert.ok(
      !smokeSteps.some((step) => step.uses === 'actions/setup-node@v6'),
      'smoke-test-production should not install Node when the verifier image already contains the runtime'
    );
    assert.ok(
      smokeRun.includes('CLASSROOMPATH_VERIFIER_IMAGE'),
      'smoke-test-production should execute from the prebuilt verifier image'
    );
    assert.ok(
      smokeRun.includes('for attempt in $(seq 1 30)'),
      'smoke-test-production should poll readiness instead of sleeping for a fixed delay'
    );
    assert.ok(
      !smokeRun.includes('sleep 30'),
      'smoke-test-production should not use a fixed 30 second stabilization sleep'
    );

    const productionDeployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(
      !productionDeployNeeds.includes('windows-firefox-canary'),
      'deploy-production should not block on the advisory Windows/Firefox canary gate'
    );
  });

  test('Windows Firefox canary workflow exists and targets staging on a Windows runner', () => {
    const workflowText = readText('.github/workflows/windows-firefox-canary.yml');
    const workflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const jobs = workflow.jobs ?? {};
    const canaryJob = jobs['windows-firefox-canary'];

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
      workflow.on?.push?.paths?.includes('upstream/openpath'),
      'release candidate workflow should rerun when the OpenPath submodule pointer changes'
    );
    assert.ok(
      workflow.on?.push?.paths?.includes('.github/workflows/firefox-release-assets.yml'),
      'release candidate workflow should rerun when the Firefox asset producer workflow changes'
    );
    assert.ok(
      jobs['derive-release-image-refs'],
      'release candidate workflow should derive immutable image refs once before the parallel image builds'
    );
    assert.ok(
      jobs['build-gateway-release-candidate'],
      'release candidate workflow should build the gateway image in its own job'
    );
    assert.ok(
      jobs['build-openpath-api-release-candidate-amd64'],
      'release candidate workflow should build the OpenPath API amd64 image in its own job'
    );
    assert.ok(
      jobs['build-openpath-api-release-candidate-arm64'],
      'release candidate workflow should build the OpenPath API arm64 image in its own job'
    );
    assert.ok(
      jobs['build-openpath-api-release-candidate'],
      'release candidate workflow should merge the OpenPath API per-architecture images into a release-candidate manifest'
    );
    assert.ok(
      jobs['build-spa-release-candidate'],
      'release candidate workflow should build the SPA image in its own job'
    );
    assert.ok(
      jobs['build-migrations-release-candidate'],
      'release candidate workflow should build the migrations runner image in its own job'
    );
    assert.ok(
      jobs['resolve-openpath-firefox-release-assets'],
      'release candidate workflow should resolve prebuilt Firefox release assets before the OpenPath API image builds'
    );
    assert.ok(
      jobs['build-verifier-release-candidate'],
      'release candidate workflow should build the verifier image in its own job'
    );
    assert.ok(
      jobs['publish-release-candidate-manifest'],
      'release candidate workflow should publish a manifest after all parallel builds finish'
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
      ].sort(),
      'manifest publication should wait for all parallel image builds'
    );

    for (const jobName of [
      'build-gateway-release-candidate',
      'build-migrations-release-candidate',
      'build-openpath-api-release-candidate-amd64',
      'build-openpath-api-release-candidate-arm64',
      'build-spa-release-candidate',
      'build-verifier-release-candidate',
    ]) {
      const jobNeeds = normalizeNeeds(jobs[jobName]?.needs);
      assert.ok(
        jobNeeds.includes('derive-release-image-refs'),
        `${jobName} should depend on the shared image-ref derivation job`
      );
      assert.ok(
        !(jobs[jobName]?.steps ?? []).some((step) => step.uses === 'actions/setup-node@v6'),
        `${jobName} should not install Node once image refs are derived centrally`
      );
    }

    const firefoxPrepNeeds = normalizeNeeds(jobs['resolve-openpath-firefox-release-assets']?.needs);
    assert.deepEqual(
      firefoxPrepNeeds.sort(),
      ['derive-release-image-refs'].sort(),
      'Firefox asset resolution should run after deriving shared image refs'
    );
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.['runs-on'],
      'ubuntu-latest',
      'Firefox asset resolution should run once on ubuntu-latest before fan-out image builds'
    );

    const firefoxPrepRun =
      jobs['resolve-openpath-firefox-release-assets']?.steps
        ?.map((step) => step.run ?? '')
        .join('\n') ?? '';
    assert.ok(
      (jobs['resolve-openpath-firefox-release-assets']?.steps ?? []).some(
        (step) => step.uses === 'actions/setup-node@v6'
      ),
      'Firefox asset resolution should install Node before polling for artifacts'
    );
    assert.match(
      workflowText,
      /name:\s+Resolve prebuilt Firefox release assets[\s\S]*?env:\s+GH_TOKEN:\s+\$\{\{\s*github\.token\s*\}\}/,
      'Firefox asset resolution should export GH_TOKEN before invoking gh-backed polling helpers'
    );
    assert.ok(
      firefoxPrepRun.includes('node scripts/wait-for-release-candidate.mjs resolve-firefox-assets'),
      'Firefox asset resolution should reuse the shared release-candidate helper'
    );
    assert.ok(
      firefoxPrepRun.includes(
        '--openpath-sha "${{ needs.derive-release-image-refs.outputs.openpath_sha }}"'
      ),
      'Firefox asset resolution should target the exact OpenPath submodule SHA'
    );
    assert.ok(
      firefoxPrepRun.includes('--output-dir firefox-release-assets'),
      'Firefox asset resolution should materialize the downloaded Firefox assets into a stable directory'
    );
    assert.ok(
      firefoxPrepRun.includes('--timeout-seconds 900'),
      'Firefox asset resolution should wait long enough for the signed Firefox asset producer workflow to finish'
    );
    assert.ok(
      !firefoxPrepRun.includes('sign:firefox-release'),
      'release candidate workflow should not sign Firefox assets inline once the dedicated producer workflow exists'
    );
    assert.ok(
      !workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'),
      'release candidate workflow should not require AMO signing secrets directly'
    );
    assert.ok(
      workflowText.includes('actions/upload-artifact@v7'),
      'release candidate workflow should upload the resolved Firefox artifacts for the OpenPath API image jobs'
    );
    assert.ok(
      workflowText.includes('name: openpath-firefox-release-assets'),
      'release candidate workflow should publish a named artifact for the resolved Firefox release assets'
    );
    const migrationsBuildStep = (jobs['build-migrations-release-candidate']?.steps ?? []).find(
      (step) => step.name === 'Build and push migrations image'
    );
    assert.equal(
      migrationsBuildStep?.with?.platforms,
      'linux/amd64',
      'release candidate workflow should publish the migrations image for the x86_64 deployment target without an emulated arm64 build'
    );

    assert.equal(
      jobs['build-openpath-api-release-candidate-arm64']?.['runs-on'],
      'ubuntu-24.04-arm',
      'release candidate workflow should build the OpenPath API arm64 image on a native arm64 runner'
    );

    const openPathManifestNeeds = normalizeNeeds(
      jobs['build-openpath-api-release-candidate']?.needs
    );
    assert.deepEqual(
      openPathManifestNeeds.sort(),
      [
        'build-openpath-api-release-candidate-amd64',
        'build-openpath-api-release-candidate-arm64',
        'derive-release-image-refs',
      ].sort(),
      'OpenPath API manifest merge should wait for both per-architecture builds and the shared image refs'
    );

    for (const jobName of [
      'build-openpath-api-release-candidate-amd64',
      'build-openpath-api-release-candidate-arm64',
    ]) {
      const jobNeeds = normalizeNeeds(jobs[jobName]?.needs);
      assert.ok(
        jobNeeds.includes('resolve-openpath-firefox-release-assets'),
        `${jobName} should wait for the resolved Firefox release assets before building the image`
      );

      const jobSteps = jobs[jobName]?.steps ?? [];
      assert.ok(
        jobSteps.some((step) => step.uses === 'actions/download-artifact@v5'),
        `${jobName} should download the prepared Firefox release assets into the Docker build context`
      );
    }

    const openPathManifestRun =
      jobs['build-openpath-api-release-candidate']?.steps
        ?.map((step) => step.run ?? '')
        .join('\n') ?? '';
    assert.ok(
      openPathManifestRun.includes('docker buildx imagetools create'),
      'OpenPath API manifest merge should assemble the final multi-architecture tag from per-architecture digests'
    );
    assert.ok(
      openPathManifestRun.includes('docker buildx imagetools inspect'),
      'OpenPath API manifest merge should resolve the final immutable digest after merging the per-architecture images'
    );

    const publishManifestRun =
      jobs['publish-release-candidate-manifest']?.steps?.map((step) => step.run ?? '').join('\n') ??
      '';
    assert.ok(
      publishManifestRun.includes('CLASSROOMPATH_VERIFIER_IMAGE='),
      'release candidate manifest should publish the verifier image alongside the runtime images'
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
    assert.ok(assetJob, 'Firefox release asset workflow should define a producer job');
    assert.equal(
      assetJob?.['runs-on'],
      'ubuntu-latest',
      'Firefox release assets should be produced once on ubuntu-latest'
    );

    const assetJobRun = (assetJob?.steps ?? []).map((step) => step.run ?? '').join('\n');
    assert.ok(
      (assetJob?.steps ?? []).some((step) => step.uses === 'actions/setup-node@v6'),
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
      workflowText.includes(
        'name: openpath-firefox-release-assets-${{ steps.openpath.outputs.sha }}'
      ),
      'Firefox release asset workflow should publish OpenPath-SHA-specific artifacts'
    );
  });
});
