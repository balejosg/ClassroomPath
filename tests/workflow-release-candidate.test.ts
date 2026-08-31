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
  test('RC workflow resolves the exact OpenPath v2 contract from the checked-out gitlink', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const contractStep = workflow.jobs?.['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Resolve exact OpenPath v2 promotion contract'
    );
    const contractRun = contractStep?.run ?? '';

    assert.ok(contractStep);
    assert.equal(contractStep?.env?.OPENPATH_SHA, '${{ steps.openpath.outputs.sha }}');
    assert.ok(contractRun.includes('node scripts/resolve-openpath-promotion-contract.mjs'));
    assert.ok(contractRun.includes('--openpath-sha "$OPENPATH_SHA"'));
    assert.ok(contractRun.includes('--contract-output openpath-promotion-contract.json'));
    assert.ok(!contractRun.includes('resolve-openpath-linux-agent-version.mjs'));
  });

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
      /if ! git -C upstream\/openpath fetch --no-tags --depth=1 origin "\$openpath_base_sha" "\$openpath_head_sha"/
    );
    assert.match(fetchDiffBaseScript, /Unable to fetch OpenPath gitlink diff base/);
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
    assert.equal(flags.openpathFirefoxAssetsChanged, true);
  });

  test('release candidate detector rebuilds Firefox assets for OpenPath release packaging changes', async () => {
    const { classifyReleaseCandidateComponents, isManifestOnlyReleaseCandidateChange } =
      await import('../scripts/lib/release-candidate-components.mjs');

    for (const changedFile of [
      '.github/workflows/firefox-release-assets.yml',
      'firefox-extension/sign-firefox-release.mjs',
      'firefox-extension/build-firefox-release.mjs',
      'firefox-extension/verify-firefox-release-artifacts.mjs',
    ]) {
      const flags = classifyReleaseCandidateComponents({
        changedFiles: ['upstream/openpath'],
        openpathChangedFiles: [changedFile],
      });

      assert.equal(flags.openpathFirefoxAssetsChanged, true, changedFile);
      assert.equal(flags.verifierChanged, true, changedFile);
      assert.equal(isManifestOnlyReleaseCandidateChange(flags), false, changedFile);
    }
  });

  test('release candidate detector changes rebuild server images without forcing Firefox signing', async () => {
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
      assert.equal(flags.openpathFirefoxAssetsChanged, false);
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
    assert.ok(reusableWorkflowText.includes('amd64_queue_seconds:'));
    assert.ok(reusableWorkflowText.includes('arm64_queue_seconds:'));
    assert.ok(reusableWorkflowText.includes('amd64_execution_seconds:'));
    assert.ok(reusableWorkflowText.includes('arm64_execution_seconds:'));
    assert.ok(reusableWorkflowText.includes('build-arm64:'));
    assert.ok(reusableWorkflowText.includes('ubuntu-24.04-arm'));
    assert.ok(reusableWorkflowText.includes('linux/arm64'));
    assert.ok(reusableWorkflowText.includes('publish_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('family_duration_seconds:'));
    assert.ok(reusableWorkflowText.includes('amd64_build_mode:'));
    assert.ok(reusableWorkflowText.includes('arm64_build_mode:'));
    assert.ok(
      reusableWorkflowText.includes('amd64_cache_scope:') &&
        reusableWorkflowText.includes('arm64_cache_scope:') &&
        reusableWorkflowText.includes('cache-scope: ${{ inputs.amd64_cache_scope }}') &&
        reusableWorkflowText.includes('cache-scope: ${{ inputs.arm64_cache_scope }}'),
      'release candidate reusable workflow should pass stable per-platform cache scopes'
    );
    assert.ok(
      buildImageActionText.includes('actions/download-artifact@v7') &&
        buildImageActionText.includes('docker/build-push-action@v7')
    );
    assert.ok(
      buildImageActionText.includes('cache-from: type=gha,scope=${{ inputs.cache-scope }}') &&
        buildImageActionText.includes(
          'cache-to: type=gha,mode=max,scope=${{ inputs.cache-scope }}'
        ),
      'release candidate image action should use GitHub Actions buildx cache'
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
    const firefoxAssetsDockerignore = readText(
      'docker/Dockerfile.openpath-firefox-assets.dockerignore'
    );
    const jobs = workflow.jobs ?? {};
    const workflowText = readText('.github/workflows/release-candidate-images.yml');

    assert.ok(workflow.on?.push?.branches?.includes('main'));
    assert.equal(
      workflow.on?.push?.paths,
      undefined,
      'every main SHA needs a release-candidate manifest so unattended nightly can resolve it'
    );
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(jobs['derive-release-image-refs']);
    const previousManifestJob = jobs['resolve-previous-release-candidate-manifest'];
    for (const field of [
      'windows_offline_installer_template_version',
      'windows_offline_installer_template_commit',
      'windows_offline_installer_template_release_tag',
      'windows_offline_installer_template_sha256',
    ]) {
      assert.equal(
        previousManifestJob?.outputs?.[field],
        `\${{ steps.export.outputs.${field} }}`,
        `previous RC resolver must expose ${field}`
      );
    }
    const deriveStepNames =
      jobs['derive-release-image-refs']?.steps?.map((step) => step.name ?? '') ?? [];
    const deriveOpenPathShaRun =
      jobs['derive-release-image-refs']?.steps?.find((step) => step.name === 'Resolve OpenPath SHA')
        ?.run ?? '';
    assert.ok(deriveOpenPathShaRun.includes('git rev-parse HEAD:upstream/openpath'));
    const deriveOpenPathContractStep = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Resolve exact OpenPath v2 promotion contract'
    );
    assert.ok(
      deriveOpenPathContractStep,
      'RC workflow must resolve one exact OpenPath v2 contract from the checked-out gitlink'
    );
    assert.equal(
      deriveOpenPathContractStep?.env?.OPENPATH_SHA,
      '${{ steps.openpath.outputs.sha }}'
    );
    assert.ok(
      String(deriveOpenPathContractStep?.run ?? '').includes(
        'node scripts/resolve-openpath-promotion-contract.mjs'
      )
    );
    assert.ok(
      String(deriveOpenPathContractStep?.run ?? '').includes(
        '--contract-output openpath-promotion-contract.json'
      )
    );
    const resolveOfflineInstallerStep = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Resolve Windows offline installer template pin'
    );
    assert.equal(resolveOfflineInstallerStep, undefined);
    assert.ok(
      deriveStepNames.includes('Resolve exact OpenPath v2 promotion contract') &&
        !deriveStepNames.includes('Resolve OpenPath Linux agent version') &&
        !deriveStepNames.includes('Resolve OpenPath installer template version'),
      'legacy Linux and Windows selectors must not remain in the active RC workflow'
    );
    const verifyOpenPathPrereleaseAptJob = jobs['verify-openpath-prerelease-apt'];
    const verifyInstallabilityStep = verifyOpenPathPrereleaseAptJob?.steps?.find(
      (step) => step.name === 'Verify OpenPath Linux agent APT installability'
    );
    const verifyInstallabilityRun = verifyInstallabilityStep?.run ?? '';
    const waitForOpenPathAptPublishStep = verifyOpenPathPrereleaseAptJob?.steps?.find(
      (step) => step.name === 'Wait for OpenPath prerelease APT publish'
    );
    const openPathDispatchTokenStep = verifyOpenPathPrereleaseAptJob?.steps?.find(
      (step) => step.name === 'Create OpenPath dispatch token'
    );
    const waitForOpenPathAptPublishRun = waitForOpenPathAptPublishStep?.run ?? '';
    const waitForOpenPathAptPublishEnv = waitForOpenPathAptPublishStep?.env ?? {};
    const aptStepNames =
      verifyOpenPathPrereleaseAptJob?.steps?.map((step) => step.name ?? '') ?? [];
    const aptFetchDiffBaseStep = verifyOpenPathPrereleaseAptJob?.steps?.find(
      (step) => step.name === 'Fetch release candidate diff base'
    );
    const deriveCheckout = jobs['derive-release-image-refs']?.steps?.find(
      (step) => step.name === 'Checkout'
    );
    assert.equal(
      waitForOpenPathAptPublishEnv['OPENPATH_REQUIRED_CHECKS'],
      'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'
    );
    assert.equal(
      waitForOpenPathAptPublishEnv['OPENPATH_PRERELEASE_RECOVERY_MODE'],
      'rerun-failed-once'
    );
    assert.equal(openPathDispatchTokenStep?.uses, 'actions/create-github-app-token@v3');
    assert.equal(openPathDispatchTokenStep?.with?.['permission-actions'], 'write');
    assert.equal(openPathDispatchTokenStep?.with?.['permission-contents'], 'write');
    assert.equal(openPathDispatchTokenStep?.with?.owner, '${{ github.repository_owner }}');
    assert.equal(openPathDispatchTokenStep?.with?.repositories, 'openpath');
    assert.equal(
      waitForOpenPathAptPublishEnv['OPENPATH_REQUIRED_CHECKS_DISPATCH_TOKEN'],
      '${{ steps.openpath-dispatch-token.outputs.token }}'
    );
    assert.equal(waitForOpenPathAptPublishEnv['OPENPATH_REQUIRED_CHECKS_AUTO_DISPATCH'], true);
    assert.deepEqual(
      normalizeNeeds(jobs['derive-release-image-refs']?.needs).sort(),
      ['detect-release-candidate-components', 'resolve-previous-release-candidate-manifest'].sort()
    );
    assert.ok(
      waitForOpenPathAptPublishRun.includes('node scripts/openpath-required-checks.mjs wait')
    );
    assert.ok(waitForOpenPathAptPublishRun.includes('openpath_linux_agent_required'));
    assert.ok(
      waitForOpenPathAptPublishRun.includes(
        'OpenPath Linux agent promotion contract not required; skipping prerelease APT wait.'
      )
    );
    assert.ok(
      waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS=2400')
    );
    assert.ok(waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS'));
    assert.ok(!waitForOpenPathAptPublishRun.includes('for attempt in $(seq 1 60)'));
    assert.ok(!waitForOpenPathAptPublishRun.includes('sleep 10'));
    assert.equal(aptFetchDiffBaseStep?.shell, 'bash');
    assert.equal(aptFetchDiffBaseStep?.env?.BASE_SHA, '${{ github.event.before }}');
    assert.equal(aptFetchDiffBaseStep?.env?.HEAD_SHA, '${{ github.sha }}');
    assert.ok(
      String(aptFetchDiffBaseStep?.run ?? '').includes(
        'bash scripts/fetch-release-candidate-diff-base.sh "$BASE_SHA" "$HEAD_SHA"'
      )
    );
    assert.ok(
      aptStepNames.indexOf('Checkout') < aptStepNames.indexOf('Fetch release candidate diff base')
    );
    assert.ok(
      aptStepNames.indexOf('Fetch release candidate diff base') <
        aptStepNames.indexOf('Wait for OpenPath prerelease APT publish')
    );
    assert.ok(
      aptStepNames.indexOf('Wait for OpenPath prerelease APT publish') <
        aptStepNames.indexOf('Verify OpenPath Linux agent APT installability')
    );
    assert.ok(
      deriveStepNames.indexOf('Resolve OpenPath SHA') <
        deriveStepNames.indexOf('Resolve exact OpenPath v2 promotion contract')
    );
    assert.ok(
      deriveStepNames.indexOf('Resolve exact OpenPath v2 promotion contract') <
        deriveStepNames.indexOf('Decide OpenPath-derived image reuse')
    );
    assert.ok(verifyInstallabilityStep, 'RC workflow must verify the exact APT pin is installable');
    assert.ok(
      verifyInstallabilityRun.includes('node scripts/verify-openpath-promotion-contract.mjs')
    );
    assert.ok(verifyInstallabilityRun.includes('openpath-promotion-contract-input'));
    assert.equal(
      deriveCheckout?.with?.['fetch-depth'],
      0,
      'derive job needs OpenPath first-parent history to resolve the pinned SHA promotion contract'
    );
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
        'resolve-openpath-firefox-release-assets',
        'resolve-previous-release-candidate-manifest',
        'verify-openpath-prerelease-apt',
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
    assert.equal(
      jobs['detect-release-candidate-components']?.outputs?.openpath_linux_agent_required,
      '${{ steps.detect.outputs.openpath_linux_agent_required }}'
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
    assert.ok(
      firefoxAssetsDockerignore.includes(
        '!upstream/openpath/firefox-extension/build/firefox-release/metadata.json'
      ) &&
        firefoxAssetsDockerignore.includes(
          '!upstream/openpath/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi'
        ),
      'Firefox assets Dockerfile-specific ignore must keep release artifacts in the Docker build context'
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

  test('release candidate workflow gates manifest publication, not image builds, on OpenPath prerelease APT', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};
    const aptJob = jobs['verify-openpath-prerelease-apt'];

    assert.ok(aptJob, 'workflow must isolate OpenPath prerelease APT verification in its own job');
    assert.deepEqual(
      normalizeNeeds(aptJob?.needs).sort(),
      ['derive-release-image-refs', 'detect-release-candidate-components'].sort()
    );

    const aptJobRun = (aptJob?.steps ?? []).map((step) => step.run ?? '').join('\n');
    assert.ok(
      aptJobRun.includes('git diff --quiet "$before_sha" "${{ github.sha }}" -- upstream/openpath')
    );
    assert.ok(aptJobRun.includes('OpenPath submodule unchanged; skipping prerelease APT wait.'));
    assert.ok(aptJobRun.includes('node scripts/openpath-required-checks.mjs wait'));
    assert.ok(aptJobRun.includes('node scripts/verify-openpath-promotion-contract.mjs'));

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
        !normalizeNeeds(jobs[jobName]?.needs).includes('verify-openpath-prerelease-apt'),
        `${jobName} should not wait on OpenPath prerelease APT`
      );
    }

    assert.ok(
      normalizeNeeds(jobs['publish-release-candidate-manifest']?.needs).includes(
        'verify-openpath-prerelease-apt'
      )
    );
    assert.ok(
      normalizeNeeds(jobs['publish-manifest-only-release-candidate']?.needs).includes(
        'verify-openpath-prerelease-apt'
      )
    );
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
        'verify-openpath-prerelease-apt',
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

    assert.ok(workflowText.includes('node scripts/release-bundle.mjs build'));
    assert.ok(workflowText.includes('node scripts/release-bundle.mjs verify'));
    assert.ok(workflowText.includes('release-bundle-${{ github.sha }}'));
    assert.ok(!workflowText.includes('resolve-openpath-linux-agent-version.mjs'));
    assert.ok(
      workflowText.includes('Build and verify Release Bundle v2 (manifest-only)') &&
        workflowText.includes('node scripts/release-bundle.mjs build') &&
        workflowText.includes('node scripts/release-bundle.mjs verify'),
      'manifest-only publication must use the exact bundle transformation and verifier'
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
      /CLASSROOMPATH_GATEWAY_IMAGE:\s*\$\{\{\s*needs\.build-gateway-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_MIGRATIONS_IMAGE:\s*\$\{\{\s*needs\.build-migrations-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /OPENPATH_FIREFOX_ASSETS_IMAGE:\s*\$\{\{\s*needs\.build-openpath-firefox-assets-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /OPENPATH_API_IMAGE:\s*\$\{\{\s*needs\.build-openpath-api-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_SPA_IMAGE:\s*\$\{\{\s*needs\.build-spa-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.match(
      workflowText,
      /CLASSROOMPATH_VERIFIER_IMAGE:\s*\$\{\{\s*needs\.build-verifier-release-candidate\.outputs\.image\s*\}\}/
    );
    assert.ok(workflowText.includes('openpath-promotion-contract-input'));
    assert.ok(workflowText.includes('release-candidate-timings-${{ github.sha }}'));
    assert.ok(workflowText.includes('release-candidate-timings.json'));
    assert.ok(workflowText.includes('## Release Candidate Timings'));
    assert.ok(workflowText.includes('### Gate Candidate'));
    assert.ok(workflowText.includes('### Firefox Release Asset Evidence'));
    assert.ok(
      workflowText.includes(
        '"firefoxReleaseState": "${{ needs.resolve-openpath-firefox-release-assets.outputs.release-state }}"'
      )
    );
    assert.ok(
      workflowText.includes(
        '"firefoxArtifactSource": "${{ needs.resolve-openpath-firefox-release-assets.outputs.artifact-source }}"'
      )
    );
    assert.ok(
      workflowText.includes(
        '"firefoxAmoFileStatus": "${{ needs.resolve-openpath-firefox-release-assets.outputs.amo-file-status }}"'
      )
    );
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
    assert.ok(workflowText.includes('amd64CacheScope'));
    assert.ok(workflowText.includes('arm64CacheScope'));
    assert.ok(workflowText.includes('amd64QueueSeconds'));
    assert.ok(workflowText.includes('arm64QueueSeconds'));
    assert.ok(workflowText.includes('amd64ExecutionSeconds'));
    assert.ok(workflowText.includes('arm64ExecutionSeconds'));
    assert.ok(workflowText.includes('amd64BuildMode'));
    assert.ok(workflowText.includes('arm64BuildMode'));
    assert.ok(workflowText.includes('buildMode'));
    assert.ok(workflowText.includes('queueSeconds'));
    assert.ok(workflowText.includes('executionSeconds'));
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
    assert.equal(
      workflow.on?.workflow_call?.outputs?.['release-state']?.value,
      '${{ jobs.prepare-firefox-release-assets.outputs.release-state }}'
    );
    assert.equal(
      workflow.on?.workflow_call?.outputs?.['artifact-source']?.value,
      '${{ jobs.prepare-firefox-release-assets.outputs.artifact-source }}'
    );
    assert.equal(
      workflow.on?.workflow_call?.outputs?.['amo-file-status']?.value,
      '${{ jobs.prepare-firefox-release-assets.outputs.amo-file-status }}'
    );
    assert.ok(assetJob);
    assert.equal(assetJob?.['runs-on'], 'ubuntu-latest');
    assert.equal(
      assetJob?.outputs?.['release-state'],
      '${{ steps.evidence.outputs.release-state || steps.skipped-evidence.outputs.release-state }}'
    );
    assert.equal(
      assetJob?.outputs?.['artifact-source'],
      '${{ steps.evidence.outputs.artifact-source || steps.skipped-evidence.outputs.artifact-source }}'
    );
    assert.equal(
      assetJob?.outputs?.['amo-file-status'],
      '${{ steps.evidence.outputs.amo-file-status || steps.skipped-evidence.outputs.amo-file-status }}'
    );
    assert.ok((assetJob?.steps ?? []).some((step) => step.uses === './.github/actions/setup-node'));
    assert.ok(assetJobRun.includes('npm ci'));
    assert.ok(assetJobRun.includes('npm run build --workspace=@openpath/firefox-extension'));
    assert.ok(assetJobRun.includes('release:payload-hash --workspace=@openpath/firefox-extension'));
    assert.ok(assetJobRun.includes('FIREFOX_RELEASE_PAYLOAD_HASH='));
    assert.ok(assetJobRun.includes('node scripts/resolve-firefox-release-assets-cache.mjs'));
    assert.ok(assetJobRun.includes('--fallback-repo "$FIREFOX_RELEASE_ASSETS_FALLBACK_REPO"'));
    assert.ok(workflowText.includes('FIREFOX_RELEASE_ASSETS_FALLBACK_REPO: balejosg/OpenPath'));
    assert.ok(workflowText.includes('Report Firefox release asset cache decision'));
    assert.ok(workflowText.includes('Classify Firefox release asset evidence'));
    assert.ok(workflowText.includes('Report Firefox release asset evidence'));
    assert.ok(workflowText.includes('Require signed Firefox release artifacts'));
    assert.ok(workflowText.includes('steps.evidence.outputs.release-state'));
    assert.ok(workflowText.includes('manual-review-required'));
    assert.ok(workflowText.includes('amo_file_status'));
    assert.ok(workflowText.includes('artifact_source'));
    assert.ok(workflowText.includes('- payload_hash: $PAYLOAD_HASH'));
    assert.ok(workflowText.includes('- artifact_name: $ARTIFACT_NAME'));
    assert.ok(workflowText.includes('- source_repo: $source_repo'));
    assert.ok(workflowText.includes('- resolved: $RESOLVED'));
    assert.ok(workflowText.includes('- cache_miss_reason: $cache_miss_reason'));
    assert.ok(workflowText.includes('AMO signing required because signed artifact cache miss'));
    assert.ok(assetJobRun.includes('payload-hash.txt'));
    assert.ok(
      assetJobRun.includes('node firefox-extension/verify-firefox-release-artifacts.mjs') &&
        assetJobRun.includes('--payload-hash "$FIREFOX_RELEASE_PAYLOAD_HASH"')
    );
    assert.ok(assetJobRun.includes('OPENPATH_FIREFOX_RELEASE_VERSION='));
    assert.ok(assetJobRun.includes('node scripts/firefox-release-version.mjs'));
    assert.ok(assetJobRun.includes('--manifest upstream/openpath/firefox-extension/manifest.json'));
    assert.ok(assetJobRun.includes('--source-revision upstream/openpath'));
    assert.ok(!assetJobRun.includes('--run-id "$GITHUB_RUN_ID"'));
    assert.ok(!assetJobRun.includes('--run-attempt "$GITHUB_RUN_ATTEMPT"'));
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
    assert.ok(workflowText.includes("WEB_EXT_SIGN_TOTAL_TIMEOUT_SECONDS: '1800'"));
    assert.ok(workflowText.includes("WEB_EXT_SIGN_APPROVAL_TIMEOUT_SECONDS: '1200'"));
    assert.ok(workflowText.includes("WEB_EXT_SIGN_PROCESS_TIMEOUT_BUFFER_SECONDS: '120'"));
    assert.ok(workflowText.includes("WEB_EXT_SIGN_RECOVERY_TIMEOUT_SECONDS: '1800'"));
    assert.ok(!workflowText.includes("WEB_EXT_SIGN_APPROVAL_TIMEOUT_SECONDS: '0'"));
    assert.ok(!workflowText.includes("WEB_EXT_SIGN_RECOVERY_TIMEOUT_SECONDS: '14400'"));
    assert.ok(
      workflowText.includes('artifact_name="openpath-firefox-release-assets-${OPENPATH_SHA}"')
    );
    assert.ok(
      workflowText.includes('openpath-firefox-release-assets-${FIREFOX_RELEASE_PAYLOAD_HASH}')
    );
    assert.ok(
      workflowText.includes(
        "steps.cache.outputs.resolved != 'true' || steps.cache.outputs.source_repo != github.repository"
      )
    );
    assert.ok(existsSync(resolve(projectRoot, 'scripts/firefox-release-version.mjs')));
    assert.ok(existsSync(resolve(projectRoot, 'scripts/firefox-release-evidence.mjs')));
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
      /node scripts\/resolve-openpath-promotion-contract\.mjs[\s\S]*--openpath-sha/
    );
    assert.match(
      String(installabilityStep?.run ?? ''),
      /node scripts\/verify-openpath-promotion-contract\.mjs[\s\S]*--contract-file/
    );
    assert.match(
      String(installabilityStep?.run ?? ''),
      /--openpath-sha "\$\{\{ steps\.check\.outputs\.latest \}\}"/
    );
    assert.ok(!workflowText.includes('resolve-openpath-linux-agent-version.mjs'));
    assert.ok(
      installabilityIndex >= 0 &&
        updateSubmoduleIndex >= 0 &&
        installabilityIndex < updateSubmoduleIndex,
      'OpenPath sync should verify APT installability before updating the submodule'
    );
  });
});
