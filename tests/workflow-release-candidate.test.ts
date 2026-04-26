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
  if?: string;
  with?: Record<string, unknown>;
  steps?: Array<{
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
  }>;
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
    const fetchDiffBaseScript = readProjectText('scripts/fetch-release-candidate-diff-base.sh');

    assert.match(detectScript, /node scripts\/lib\/release-candidate-components\.mjs classify/);
    assert.match(detectScript, /git show "\$BASE_SHA:package\.json"/);
    assert.match(detectScript, /--package-json-before/);
    assert.match(detectScript, /--package-json-after/);
    assert.match(detectScript, /git -C upstream\/openpath rev-parse --is-inside-work-tree/);
    assert.match(fetchDiffBaseScript, /git fetch --no-tags --depth=1 origin "\$BASE_SHA"/);
    assert.match(
      fetchDiffBaseScript,
      /git -C upstream\/openpath fetch --no-tags --depth=1 origin "\$openpath_base_sha" "\$openpath_head_sha"/
    );
    assert.match(detectScript, /__unknown_openpath_gitlink_change__/);
    assert.ok(!detectScript.includes('-d upstream/openpath/.git'));
    assert.ok(!detectScript.includes('cannot infer which OpenPath workspace changed'));
  });

  test('release candidate detector rebuilds every image family when an OpenPath gitlink diff is unknown', async () => {
    const { classifyReleaseCandidateComponents } =
      await import('../scripts/lib/release-candidate-components.mjs');

    const flags = classifyReleaseCandidateComponents({
      changedFiles: ['upstream/openpath'],
      openpathChangedFiles: ['__unknown_openpath_gitlink_change__'],
    });

    assert.deepEqual(flags, {
      gatewayChanged: true,
      migrationsChanged: true,
      openpathApiChanged: true,
      spaChanged: true,
      verifierChanged: true,
    });
  });

  test('release candidate detector changes rebuild every image family', async () => {
    const { classifyReleaseCandidateComponents } =
      await import('../scripts/lib/release-candidate-components.mjs');

    for (const changedFile of [
      'scripts/detect-release-candidate-components.sh',
      'scripts/lib/release-candidate-components.mjs',
    ]) {
      const flags = classifyReleaseCandidateComponents({
        changedFiles: [changedFile],
        openpathChangedFiles: [],
      });

      assert.deepEqual(flags, {
        gatewayChanged: true,
        migrationsChanged: true,
        openpathApiChanged: true,
        spaChanged: true,
        verifierChanged: true,
      });
    }
  });

  test('release candidate workflow keeps image family contracts centralized', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
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

    assert.equal(
      workflow.jobs?.['resolve-openpath-firefox-release-assets']?.uses,
      './.github/workflows/firefox-release-assets.yml'
    );
    assert.ok(
      workflowText.includes('./.github/workflows/reusable-release-candidate-image-family.yml') &&
        reusableWorkflowText.includes('./.github/actions/publish-release-candidate-manifest')
    );
    assert.ok(reusableWorkflowText.includes('amd64_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('arm64_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('build-arm64:'));
    assert.ok(reusableWorkflowText.includes('ubuntu-24.04-arm'));
    assert.ok(reusableWorkflowText.includes('linux/arm64'));
    assert.ok(reusableWorkflowText.includes('publish_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('family_duration_seconds:'));
    assert.ok(
      buildImageActionText.includes('actions/download-artifact@v7') &&
        buildImageActionText.includes('docker/build-push-action@v7')
    );
    assert.ok(
      publishManifestActionText.includes('docker buildx imagetools create') &&
        publishManifestActionText.includes('docker buildx imagetools inspect') &&
        publishManifestActionText.includes('seq 1 36') &&
        publishManifestActionText.includes('Waiting for manifest digest') &&
        publishManifestActionText.includes('amd64-digest') &&
        publishManifestActionText.includes('arm64-digest')
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
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(jobs['derive-release-image-refs']);
    const deriveOpenPathShaRun =
      jobs['derive-release-image-refs']?.steps?.find((step) => step.name === 'Resolve OpenPath SHA')
        ?.run ?? '';
    assert.ok(deriveOpenPathShaRun.includes('git rev-parse HEAD:upstream/openpath'));
    const deriveLinuxAgentVersionRun =
      jobs['derive-release-image-refs']?.steps?.find(
        (step) => step.name === 'Resolve OpenPath Linux agent version'
      )?.run ?? '';
    const verifyInstallabilityStep = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Verify OpenPath Linux agent APT installability'
    );
    const verifyInstallabilityRun = verifyInstallabilityStep?.run ?? '';
    const waitForOpenPathAptPublishRun =
      jobs['derive-release-image-refs']?.steps?.find(
        (step) => step.name === 'Wait for OpenPath prerelease APT publish'
      )?.run ?? '';
    const waitForOpenPathAptPublishEnv =
      jobs['derive-release-image-refs']?.steps?.find(
        (step) => step.name === 'Wait for OpenPath prerelease APT publish'
      )?.env ?? {};
    const deriveStepNames =
      jobs['derive-release-image-refs']?.steps?.map((step) => step.name ?? '') ?? [];
    const deriveCheckout = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    assert.equal(
      waitForOpenPathAptPublishEnv['OPENPATH_REQUIRED_CHECKS'],
      'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'
    );
    assert.ok(
      waitForOpenPathAptPublishRun.includes('node scripts/openpath-required-checks.mjs wait')
    );
    assert.ok(
      waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS=2400')
    );
    assert.ok(waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS'));
    assert.ok(!waitForOpenPathAptPublishRun.includes('for attempt in $(seq 1 60)'));
    assert.ok(!waitForOpenPathAptPublishRun.includes('sleep 10'));
    assert.ok(
      deriveStepNames.indexOf('Wait for OpenPath prerelease APT publish') <
        deriveStepNames.indexOf('Resolve OpenPath Linux agent version')
    );
    assert.ok(
      deriveStepNames.indexOf('Resolve OpenPath Linux agent version') <
        deriveStepNames.indexOf('Verify OpenPath Linux agent APT installability')
    );
    assert.ok(
      deriveLinuxAgentVersionRun.includes('node scripts/resolve-openpath-linux-agent-version.mjs')
    );
    assert.ok(verifyInstallabilityStep, 'RC workflow must verify the exact APT pin is installable');
    assert.ok(verifyInstallabilityRun.includes('git diff --quiet'));
    assert.ok(verifyInstallabilityRun.includes('[ -n "$before_sha" ]'));
    assert.ok(verifyInstallabilityRun.includes('upstream/openpath'));
    assert.ok(
      verifyInstallabilityRun.includes(
        'node scripts/resolve-openpath-linux-agent-version.mjs install-probe-script'
      )
    );
    assert.ok(verifyInstallabilityRun.includes('docker run --rm -i ubuntu:24.04 bash'));
    assert.equal(deriveCheckout?.with?.['fetch-depth'], 1);
    assert.equal(
      jobs['build-gateway-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml'
    );
    assert.equal(
      jobs['build-openpath-firefox-assets-release-candidate']?.uses,
      './.github/workflows/reusable-release-candidate-image-family.yml'
    );
    assert.ok(jobs['build-openpath-api-release-candidate']);
    assert.ok(jobs['build-spa-release-candidate']);
    assert.ok(jobs['build-migrations-release-candidate']);
    assert.ok(jobs['build-verifier-release-candidate']);
    assert.equal(
      jobs['resolve-openpath-firefox-release-assets']?.uses,
      './.github/workflows/firefox-release-assets.yml'
    );
    assert.ok(jobs['publish-release-candidate-manifest']);
    const concurrency = workflow.concurrency;
    assert.equal(typeof concurrency, 'object');
    assert.equal(
      (concurrency as { group?: string }).group,
      'release-candidate-images-${{ github.ref }}'
    );
    assert.equal(
      (concurrency as { 'cancel-in-progress'?: string })['cancel-in-progress'],
      "${{ github.event_name == 'push' }}"
    );

    const manifestNeeds = normalizeNeeds(jobs['publish-release-candidate-manifest']?.needs);
    assert.deepEqual(
      manifestNeeds.sort(),
      [
        'build-gateway-release-candidate',
        'build-migrations-release-candidate',
        'build-openpath-firefox-assets-release-candidate',
        'build-openpath-api-release-candidate',
        'build-spa-release-candidate',
        'build-verifier-release-candidate',
        'detect-release-candidate-components',
        'derive-release-image-refs',
        'resolve-previous-release-candidate-manifest',
      ].sort()
    );

    for (const jobName of [
      'build-gateway-release-candidate',
      'build-migrations-release-candidate',
      'build-openpath-firefox-assets-release-candidate',
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
      assert.equal(jobs[jobName]?.with?.['arm64_cache_scope'], `${cachePrefix}-arm64`);
    }

    const detectCheckout = jobs['detect-release-candidate-components']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    const fetchDiffBaseStep = jobs['detect-release-candidate-components']?.steps?.find(
      (step) => step.name === 'Fetch release candidate diff base'
    );
    const openpathApiNeeds = normalizeNeeds(jobs['build-openpath-api-release-candidate']?.needs);
    const openpathFirefoxAssetsNeeds = normalizeNeeds(
      jobs['build-openpath-firefox-assets-release-candidate']?.needs
    );
    assert.equal(
      jobs['derive-release-image-refs']?.outputs?.openpath_firefox_assets_repo,
      '${{ steps.image-refs.outputs.openpath_firefox_assets_repo }}'
    );
    assert.equal(
      jobs['derive-release-image-refs']?.outputs?.openpath_firefox_assets_tag,
      '${{ steps.image-refs.outputs.openpath_firefox_assets_tag }}'
    );
    assert.equal(
      jobs['detect-release-candidate-components']?.outputs?.openpath_firefox_assets_changed,
      '${{ steps.detect.outputs.openpath_firefox_assets_changed }}'
    );
    assert.deepEqual(
      openpathFirefoxAssetsNeeds.sort(),
      [
        'derive-release-image-refs',
        'detect-release-candidate-components',
        'resolve-previous-release-candidate-manifest',
        'resolve-openpath-firefox-release-assets',
      ].sort()
    );
    assert.equal(
      jobs['build-openpath-firefox-assets-release-candidate']?.with?.file,
      'docker/Dockerfile.openpath-firefox-assets'
    );
    assert.equal(
      jobs['build-openpath-firefox-assets-release-candidate']?.with?.image_repo,
      '${{ needs.derive-release-image-refs.outputs.openpath_firefox_assets_repo }}'
    );
    assert.equal(
      jobs['build-openpath-firefox-assets-release-candidate']?.with?.previous_image,
      '${{ needs.resolve-previous-release-candidate-manifest.outputs.openpath_firefox_assets_image }}'
    );
    assert.ok(
      String(
        jobs['build-openpath-firefox-assets-release-candidate']?.with?.build_required ?? ''
      ).includes('openpath_firefox_assets_changed')
    );
    assert.deepEqual(
      openpathApiNeeds.sort(),
      [
        'derive-release-image-refs',
        'detect-release-candidate-components',
        'resolve-previous-release-candidate-manifest',
      ].sort()
    );
    assert.equal(jobs['build-openpath-api-release-candidate']?.with?.['artifact_name'], undefined);
    assert.equal(jobs['build-openpath-api-release-candidate']?.with?.['artifact_path'], undefined);
    assert.equal(
      jobs['build-openpath-api-release-candidate']?.with?.['openpath_sha'],
      '${{ needs.derive-release-image-refs.outputs.openpath_sha }}'
    );
    assert.ok(
      String(jobs['build-openpath-api-release-candidate']?.with?.['build_required'] ?? '').includes(
        'openpath_api_changed'
      )
    );
    assert.equal(detectCheckout?.with?.['fetch-depth'], 1);
    assert.equal(detectCheckout?.with?.submodules, 'recursive');
    assert.ok(
      String(fetchDiffBaseStep?.run ?? '').includes(
        'bash scripts/fetch-release-candidate-diff-base.sh'
      )
    );
    assert.equal(fetchDiffBaseStep?.env?.BASE_SHA, '${{ github.event.before }}');
    assert.equal(fetchDiffBaseStep?.env?.HEAD_SHA, '${{ github.sha }}');
    assert.ok(String(fetchDiffBaseStep?.run ?? '').includes('"$BASE_SHA" "$HEAD_SHA"'));
    assert.ok(!workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'));
  });

  test('release candidate workflow publishes manifest-only changes without image-family jobs', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};
    const workflowText = readText('.github/workflows/release-candidate-images.yml');
    const detectJob = jobs['detect-release-candidate-components'];
    const fastManifestJob = jobs['publish-manifest-only-release-candidate'];
    const regularManifestJob = jobs['publish-release-candidate-manifest'];
    const manifestOnlyIf =
      "needs.resolve-previous-release-candidate-manifest.outputs.available == 'true' && needs.detect-release-candidate-components.outputs.manifest_only == 'true'";
    const regularPathIf =
      "needs.resolve-previous-release-candidate-manifest.outputs.available != 'true' || needs.detect-release-candidate-components.outputs.manifest_only != 'true'";

    assert.equal(detectJob?.outputs?.manifest_only, '${{ steps.detect.outputs.manifest_only }}');
    assert.ok(fastManifestJob, 'workflow must have a manifest-only fast-path publisher');
    assert.deepEqual(
      normalizeNeeds(fastManifestJob?.needs).sort(),
      [
        'derive-release-image-refs',
        'detect-release-candidate-components',
        'resolve-previous-release-candidate-manifest',
      ].sort()
    );
    assert.ok(String(fastManifestJob?.if ?? '').includes(manifestOnlyIf));
    assert.ok(String(regularManifestJob?.if ?? '').includes(regularPathIf));

    for (const jobName of [
      'build-gateway-release-candidate',
      'build-migrations-release-candidate',
      'resolve-openpath-firefox-release-assets',
      'build-openpath-firefox-assets-release-candidate',
      'build-openpath-api-release-candidate',
      'build-spa-release-candidate',
      'build-verifier-release-candidate',
    ]) {
      assert.ok(
        String(jobs[jobName]?.if ?? '').includes(regularPathIf),
        `${jobName} should be skipped on manifest-only changes with a previous manifest`
      );
    }

    assert.match(
      workflowText,
      /CLASSROOMPATH_GATEWAY_IMAGE=\$\{\{\s*needs\.resolve-previous-release-candidate-manifest\.outputs\.gateway_image\s*\}\}/
    );
    assert.match(
      workflowText,
      /OPENPATH_FIREFOX_ASSETS_IMAGE=\$\{\{\s*needs\.resolve-previous-release-candidate-manifest\.outputs\.openpath_firefox_assets_image\s*\}\}/
    );
    assert.match(
      workflowText,
      /OPENPATH_API_IMAGE=\$\{\{\s*needs\.resolve-previous-release-candidate-manifest\.outputs\.openpath_api_image\s*\}\}/
    );
    assert.ok(workflowText.includes('"manifestOnly": true'));
    assert.ok(workflowText.includes('### Manifest-Only Fast Path'));
    assert.ok(workflowText.includes('release-candidate-images-${{ github.sha }}'));
    assert.ok(workflowText.includes('release-candidate-timings-${{ github.sha }}'));
  });

  test('migrations release image avoids recursive ownership fixups on arm64 builds', () => {
    const dockerfile = readText('docker/Dockerfile.migrations');

    assert.ok(!dockerfile.includes('chown -R node:node /app'));
    assert.ok(dockerfile.includes('RUN chown node:node /app'));
    assert.ok(dockerfile.includes('COPY --chown=node:node api/drizzle ./api/drizzle'));
    assert.ok(
      dockerfile.includes(
        'COPY --chown=node:node upstream/openpath/api/src ./upstream/openpath/api/src'
      )
    );
  });

  test('release candidate manifest publisher reads the reusable family image output for every image slot', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const workflowText = readText('.github/workflows/release-candidate-images.yml');
    const publishSteps = workflow.jobs?.['publish-release-candidate-manifest']?.steps ?? [];
    const publishStepNames = publishSteps.map((step) => step.name ?? '');
    const checkoutIndex = publishStepNames.indexOf('Checkout');
    const summarizeIndex = publishStepNames.indexOf('Summarize release candidate timings');

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
      /OPENPATH_FIREFOX_ASSETS_IMAGE=\$\{\{\s*needs\.build-openpath-firefox-assets-release-candidate\.outputs\.image\s*\}\}/
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
    assert.match(
      workflowText,
      /OPENPATH_LINUX_AGENT_APT_SUITE=\$\{\{\s*needs\.derive-release-image-refs\.outputs\.openpath_linux_agent_apt_suite\s*\}\}/
    );
    assert.ok(workflowText.includes('release-candidate-timings-${{ github.sha }}'));
    assert.ok(workflowText.includes('release-candidate-timings.json'));
    assert.ok(workflowText.includes('## Release Candidate Timings'));
    assert.ok(workflowText.includes('### Gate Candidate'));
    assert.ok(
      workflowText.includes(
        'node scripts/measure-release-candidate-timings.mjs release-candidate-timings.json'
      )
    );
    assert.notEqual(checkoutIndex, -1);
    assert.notEqual(summarizeIndex, -1);
    assert.ok(checkoutIndex < summarizeIndex);
    assert.ok(workflowText.includes('arm64DurationSeconds'));
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

    assert.equal(workflow.on?.push, undefined);
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(workflow.on?.workflow_call);
    assert.ok(assetJob);
    assert.equal(assetJob?.['runs-on'], 'ubuntu-latest');
    assert.ok((assetJob?.steps ?? []).some((step) => step.uses === './.github/actions/setup-node'));
    assert.ok(assetJobRun.includes('npm ci'));
    assert.ok(assetJobRun.includes('npm run build --workspace=@openpath/firefox-extension'));
    assert.ok(assetJobRun.includes('release:payload-hash --workspace=@openpath/firefox-extension'));
    assert.ok(assetJobRun.includes('FIREFOX_RELEASE_PAYLOAD_HASH='));
    assert.ok(assetJobRun.includes('node scripts/resolve-firefox-release-assets-cache.mjs'));
    assert.ok(assetJobRun.includes('payload-hash.txt'));
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
    assert.ok(workflowText.includes("steps.cache.outputs.resolved != 'true'"));
    assert.ok(workflowText.includes('WEB_EXT_API_KEY: ${{ secrets.WEB_EXT_API_KEY }}'));
    assert.ok(workflowText.includes('WEB_EXT_API_SECRET: ${{ secrets.WEB_EXT_API_SECRET }}'));
    assert.ok(
      workflowText.includes('artifact_name="openpath-firefox-release-assets-${OPENPATH_SHA}"')
    );
    assert.ok(
      workflowText.includes('openpath-firefox-release-assets-${FIREFOX_RELEASE_PAYLOAD_HASH}')
    );
    assert.ok(existsSync(resolve(projectRoot, 'scripts/firefox-release-version.mjs')));
    assert.ok(existsSync(resolve(projectRoot, 'scripts/resolve-firefox-release-assets-cache.mjs')));
    assert.ok(existsSync(resolve(projectRoot, 'scripts/lib/openpath-ci-checks.mjs')));
    assert.ok(
      readText('scripts/openpath-required-checks.mjs').includes(
        "from './lib/openpath-ci-checks.mjs'"
      )
    );
  });

  test('OpenPath sync workflow lets the required-check script derive risk from the upstream diff', () => {
    const workflowText = readText('.github/workflows/sync-openpath.yml');
    const workflow = readWorkflow('.github/workflows/sync-openpath.yml');
    const steps = workflow.jobs?.sync?.steps ?? [];
    const installabilityStep = steps.find(
      (step) => step.name === 'Verify OpenPath Linux agent APT installability'
    );
    const updateSubmoduleIndex = steps.findIndex((step) => step.name === 'Update submodule');
    const installabilityIndex = steps.findIndex(
      (step) => step.name === 'Verify OpenPath Linux agent APT installability'
    );

    assert.ok(workflowText.includes('OPENPATH_BASE_SHA: ${{ steps.check.outputs.current }}'));
    assert.ok(workflowText.includes('OPENPATH_SHA: ${{ steps.check.outputs.latest }}'));
    assert.ok(workflowText.includes('node scripts/openpath-required-checks.mjs wait'));
    assert.ok(workflowText.includes('OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS=2400'));
    assert.ok(workflowText.includes('OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS'));
    assert.ok(!workflowText.includes('OPENPATH_REQUIRED_CHECKS: CI Success'));
    assert.ok(
      installabilityStep,
      'OpenPath sync should not advance ClassroomPath until the exact Linux APT pin is installable'
    );
    assert.match(
      String(installabilityStep?.run ?? ''),
      /node scripts\/resolve-openpath-linux-agent-version\.mjs[\s\S]*--openpath-dir upstream\/openpath/
    );
    assert.match(
      String(installabilityStep?.run ?? ''),
      /node scripts\/resolve-openpath-linux-agent-version\.mjs verify-runtime-pin/
    );
    assert.match(
      String(installabilityStep?.run ?? ''),
      /node scripts\/resolve-openpath-linux-agent-version\.mjs install-probe-script[\s\S]*docker run --rm -i ubuntu:24\.04 bash/
    );
    assert.ok(
      installabilityIndex >= 0 &&
        updateSubmoduleIndex >= 0 &&
        installabilityIndex < updateSubmoduleIndex,
      'OpenPath sync should verify APT installability before updating the submodule'
    );
  });
});
