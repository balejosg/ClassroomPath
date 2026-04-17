import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  readProjectText,
  readProjectWorkflow,
  type WorkflowDefinition,
} from './helpers/ops-contracts.ts';

type WorkflowJob = {
  needs?: string | string[];
  uses?: string;
  with?: Record<string, unknown>;
  steps?: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, unknown> }>;
  'runs-on'?: string | string[];
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

describe('Release candidate workflow contracts', () => {
  test('release candidate detector classifies OpenPath gitlink changes through the shared component mapper', () => {
    const detectScriptPath = resolve(projectRoot, 'scripts/detect-release-candidate-components.sh');
    const detectScript = readFileSync(detectScriptPath, 'utf-8');

    assert.match(detectScript, /node scripts\/lib\/release-candidate-components\.mjs classify/);
    assert.ok(!detectScript.includes('cannot infer which OpenPath workspace changed'));
  });

  test('release candidate workflow keeps Firefox signing and reusable family contracts centralized', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const firefoxAssetsJob = workflow.jobs?.['resolve-openpath-firefox-release-assets'];
    const workflowText = readText('.github/workflows/release-candidate-images.yml');
    const reusableWorkflowText = readText(
      '.github/workflows/reusable-release-candidate-image-family.yml'
    );
    const buildImageActionText = readText(
      '.github/actions/build-release-candidate-image/action.yml'
    );
    const publishManifestActionText = readText(
      '.github/actions/publish-release-candidate-manifest/action.yml'
    );

    assert.equal(firefoxAssetsJob?.uses, './.github/workflows/firefox-release-assets.yml');
    assert.equal(firefoxAssetsJob?.secrets, 'inherit');
    assert.ok(
      workflowText.includes('./.github/workflows/reusable-release-candidate-image-family.yml') &&
        reusableWorkflowText.includes('./.github/actions/publish-release-candidate-manifest')
    );
    assert.ok(reusableWorkflowText.includes('amd64_duration_seconds:'));
    assert.ok(!reusableWorkflowText.includes('arm64_duration_seconds:'));
    assert.ok(!reusableWorkflowText.includes('build-arm64:'));
    assert.ok(!reusableWorkflowText.includes('ubuntu-24.04-arm'));
    assert.ok(!reusableWorkflowText.includes('linux/arm64'));
    assert.ok(reusableWorkflowText.includes('publish_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('family_duration_seconds:'));
    assert.ok(
      buildImageActionText.includes('actions/download-artifact@v7') &&
        buildImageActionText.includes('docker/build-push-action@v7')
    );
    assert.ok(
      publishManifestActionText.includes('docker buildx imagetools create') &&
        publishManifestActionText.includes('docker buildx imagetools inspect') &&
        publishManifestActionText.includes('amd64-digest') &&
        !publishManifestActionText.includes('arm64-digest')
    );
  });

  test('release candidate image builds avoid noisy automatic buildx cleanup annotations', () => {
    const setupDockerBuildActionText = readText('.github/actions/setup-docker-build/action.yml');

    assert.ok(setupDockerBuildActionText.includes('docker/setup-buildx-action@v4'));
    assert.match(setupDockerBuildActionText, /cleanup:\s*false/);
  });

  test('release candidate workflow builds immutable artifacts for every main SHA before production tagging', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};
    const workflowText = readText('.github/workflows/release-candidate-images.yml');

    assert.ok(workflow.on?.push?.branches?.includes('main'));
    assert.ok(!workflow.on?.push?.paths);
    assert.ok(jobs['derive-release-image-refs']);
    const deriveOpenPathShaRun =
      jobs['derive-release-image-refs']?.steps?.find((step) => step.name === 'Resolve OpenPath SHA')
        ?.run ?? '';
    assert.ok(deriveOpenPathShaRun.includes('git rev-parse HEAD:upstream/openpath'));
    const deriveLinuxAgentVersionRun =
      jobs['derive-release-image-refs']?.steps?.find(
        (step) => step.name === 'Resolve OpenPath Linux agent version'
      )?.run ?? '';
    const deriveCheckout = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    assert.ok(
      deriveLinuxAgentVersionRun.includes('node scripts/resolve-openpath-linux-agent-version.mjs')
    );
    assert.equal(deriveCheckout?.with?.['fetch-depth'], 0);
    assert.equal(
      jobs['build-gateway-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml'
    );
    assert.ok(jobs['build-openpath-api-release-candidate']);
    assert.ok(jobs['build-spa-release-candidate']);
    assert.ok(jobs['build-migrations-release-candidate']);
    assert.ok(jobs['build-verifier-release-candidate']);
    assert.ok(jobs['resolve-openpath-firefox-release-assets']);
    assert.ok(jobs['publish-release-candidate-manifest']);
    const concurrency = workflow.concurrency;
    assert.equal(typeof concurrency, 'object');
    assert.equal((concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'], false);

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
      ].sort()
    );

    for (const jobName of [
      'build-gateway-release-candidate',
      'build-migrations-release-candidate',
      'build-openpath-api-release-candidate',
      'build-spa-release-candidate',
      'build-verifier-release-candidate',
    ]) {
      const jobNeeds = normalizeNeeds(jobs[jobName]?.needs);
      assert.ok(jobNeeds.includes('derive-release-image-refs'));
      assert.ok(
        String(jobs[jobName]?.uses ?? '').includes(
          './.github/workflows/reusable-release-candidate-image-family.yml'
        )
      );
      assert.ok(!String(jobs[jobName]?.uses ?? '').includes('actions/setup-node@v6'));
    }

    assert.equal(
      jobs['build-gateway-release-candidate']?.with?.['amd64_cache_scope'],
      'release-candidate-gateway-amd64'
    );

    for (const [jobName, cachePrefix] of [
      ['build-gateway-release-candidate', 'release-candidate-gateway'],
      ['build-migrations-release-candidate', 'release-candidate-migrations'],
      ['build-openpath-api-release-candidate', 'release-candidate-openpath-api'],
      ['build-spa-release-candidate', 'release-candidate-spa'],
      ['build-verifier-release-candidate', 'release-candidate-verifier'],
    ] as const) {
      assert.equal(jobs[jobName]?.with?.['amd64_cache_scope'], `${cachePrefix}-amd64`);
      assert.equal(jobs[jobName]?.with?.['arm64_cache_scope'], undefined);
    }

    const detectCheckout = jobs['detect-release-candidate-components']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    const firefoxPrepNeeds = normalizeNeeds(jobs['resolve-openpath-firefox-release-assets']?.needs);
    assert.deepEqual(
      firefoxPrepNeeds.sort(),
      [
        'derive-release-image-refs',
        'detect-release-candidate-components',
        'resolve-previous-release-candidate-manifest',
      ].sort()
    );
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.uses,
      './.github/workflows/firefox-release-assets.yml'
    );
    assert.ok(
      String(
        jobs['resolve-openpath-firefox-release-assets']?.with?.['build_required'] ?? ''
      ).includes('openpath_api_changed')
    );
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.with?.['artifact_name'],
      'openpath-firefox-release-assets'
    );
    assert.equal(detectCheckout?.with?.['fetch-depth'], 0);
    assert.equal(detectCheckout?.with?.submodules, 'recursive');
    assert.ok(!workflowText.includes('wait-for-release-candidate.mjs resolve-firefox-assets'));
    assert.ok(!workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'));
  });

  test('release candidate manifest publisher reads the reusable family image output for every image slot', () => {
    const workflowText = readText('.github/workflows/release-candidate-images.yml');

    assert.match(
      workflowText,
      /CLASSROOMPATH_GATEWAY_IMAGE=\$\{\{\s*needs\.build-gateway-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_MIGRATIONS_IMAGE=\$\{\{\s*needs\.build-migrations-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /OPENPATH_API_IMAGE=\$\{\{\s*needs\.build-openpath-api-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_SPA_IMAGE=\$\{\{\s*needs\.build-spa-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_VERIFIER_IMAGE=\$\{\{\s*needs\.build-verifier-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.ok(workflowText.includes('release-candidate-timings-${{ github.sha }}'));
    assert.ok(workflowText.includes('release-candidate-timings.json'));
    assert.ok(workflowText.includes('## Release Candidate Timings'));
    assert.ok(!workflowText.includes('arm64DurationSeconds'));
    assert.ok(workflowText.includes('familyDurationSeconds'));
    assert.doesNotMatch(
      workflowText,
      /needs\.build-gateway-release-candidate\.outputs\.gateway_image/
    );
  });

  test('Firefox release asset producer signs and publishes versioned artifacts', () => {
    const workflow = readWorkflow('.github/workflows/firefox-release-assets.yml');
    const workflowText = readText('.github/workflows/firefox-release-assets.yml');
    const jobs = workflow.jobs ?? {};
    const assetJob = jobs['prepare-firefox-release-assets'];
    const assetJobRun = (assetJob?.steps ?? []).map((step) => step.run ?? '').join('\n');
    const firefoxVersionCli = readText('scripts/firefox-release-version.mjs');
    const firefoxVersionLib = readText('scripts/lib/firefox-release-version.mjs');
    const githubActionsLib = readText('scripts/lib/github-actions.mjs');

    assert.ok(workflow.on?.push?.branches?.includes('main'));
    assert.ok(workflow.on?.push?.paths?.includes('upstream/openpath'));
    assert.ok(workflow.on?.push?.paths?.includes('docker/Dockerfile.api'));
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(workflow.on?.workflow_call);
    assert.ok(assetJob);
    assert.equal(assetJob?.['runs-on'], 'ubuntu-latest');
    assert.ok((assetJob?.steps ?? []).some((step) => step.uses === './.github/actions/setup-node'));
    assert.ok(assetJobRun.includes('npm ci'));
    assert.ok(assetJobRun.includes('npm run build --workspace=@openpath/firefox-extension'));
    assert.ok(assetJobRun.includes('OPENPATH_FIREFOX_RELEASE_VERSION='));
    assert.ok(assetJobRun.includes('node scripts/firefox-release-version.mjs'));
    assert.ok(assetJobRun.includes('--manifest upstream/openpath/firefox-extension/manifest.json'));
    assert.ok(assetJobRun.includes('--run-id "$GITHUB_RUN_ID"'));
    assert.ok(assetJobRun.includes('--run-attempt "$GITHUB_RUN_ATTEMPT"'));
    assert.ok(!assetJobRun.includes('run_id_component="$((10#$run_id_suffix))"'));
    assert.ok(
      firefoxVersionCli.includes("from './lib/firefox-release-version.mjs'") &&
        firefoxVersionLib.includes('export function deriveFirefoxReleaseVersionFromManifest')
    );
    assert.ok(githubActionsLib.includes('export function writeOutputs('));
    assert.ok(
      assetJobRun.includes('npm run sign:firefox-release --workspace=@openpath/firefox-extension')
    );
    assert.ok(workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'));
    assert.ok(workflowText.includes('WEB_EXT_API_SECRET: ${{ secrets.WEB_EXT_API_SECRET }}'));
    assert.ok(
      workflowText.includes('artifact_name="openpath-firefox-release-assets-${OPENPATH_SHA}"')
    );
    assert.ok(existsSync(resolve(projectRoot, 'scripts/firefox-release-version.mjs')));
    assert.ok(existsSync(resolve(projectRoot, 'scripts/lib/openpath-ci-checks.mjs')));
    assert.ok(
      readText('scripts/openpath-required-checks.mjs').includes(
        "from './lib/openpath-ci-checks.mjs'"
      )
    );
  });
});
