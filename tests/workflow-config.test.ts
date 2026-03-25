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
  steps?: Array<{
    name?: string;
    id?: string;
    run?: string;
    uses?: string;
    'working-directory'?: string;
  }>;
};

type WorkflowDefinition = {
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  on?: {
    push?: {
      branches?: string[];
      tags?: string[];
    };
  };
  jobs?: Record<string, WorkflowJob>;
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

describe('Workflow configuration hardening', () => {
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
  });

  test('Release candidate workflow builds images for main before a production tag exists', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(
      workflow.on?.push?.branches?.includes('main'),
      'release candidate workflow should trigger on pushes to main'
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
});
