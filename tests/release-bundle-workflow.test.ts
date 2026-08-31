import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText, readProjectWorkflow } from './helpers/ops-contracts.ts';

describe('Release Bundle v2 workflow contracts', () => {
  test('propagates OpenPath provenance labels through the reusable image action', () => {
    const action = readProjectText('.github/actions/build-release-candidate-image/action.yml');
    const reusable = readProjectText(
      '.github/workflows/reusable-release-candidate-image-family.yml'
    );

    assert.match(action, /openpath-source-sha:/);
    assert.match(action, /openpath-contract-sha256:/);
    assert.match(
      action,
      /org\.opencontainers\.image\.revision=\$\{\{ inputs\.openpath-source-sha \}\}/
    );
    assert.match(
      action,
      /eu\.classroompath\.openpath\.contract-sha256=\$\{\{ inputs\.openpath-contract-sha256 \}\}/
    );
    assert.match(reusable, /openpath_source_sha:/);
    assert.match(reusable, /openpath_contract_sha256:/);
    assert.match(reusable, /openpath-source-sha:/);
    assert.match(reusable, /openpath-contract-sha256:/);
  });

  test('publishing verifies immutable image labels against the exact contract identity', () => {
    const action = readProjectText('.github/actions/publish-release-candidate-manifest/action.yml');
    const reusable = readProjectText(
      '.github/workflows/reusable-release-candidate-image-family.yml'
    );

    assert.match(action, /openpath-source-sha:/u);
    assert.match(action, /openpath-contract-sha256:/u);
    assert.match(action, /child_ref="\$\{image%@\*\}@\$\{child_digest\}"/u);
    assert.match(action, /docker pull "\$child_ref"/u);
    assert.match(action, /docker image inspect --format .* "\$child_ref"/u);
    assert.match(action, /docker buildx imagetools inspect --raw "\$image"/u);
    assert.match(action, /for platform in linux\/amd64 linux\/arm64/u);
    assert.doesNotMatch(action, /docker image inspect --platform/u);
    assert.doesNotMatch(action, /docker pull --platform "\$platform" "\$image"/u);
    assert.match(action, /jq -er/u);
    assert.match(action, /org\.opencontainers\.image\.revision/u);
    assert.match(action, /eu\.classroompath\.openpath\.contract-sha256/u);
    assert.match(reusable, /openpath-source-sha: \$\{\{ inputs\.openpath_source_sha \}\}/u);
    assert.match(
      reusable,
      /openpath-contract-sha256: \$\{\{ inputs\.openpath_contract_sha256 \}\}/u
    );
  });

  test('RC resolves one exact contract and publishes bundle artifacts', () => {
    const workflow = readProjectText('.github/workflows/release-candidate-images.yml');

    assert.match(workflow, /scripts\/resolve-openpath-promotion-contract\.mjs/);
    assert.match(workflow, /openpath-promotion-contract\.json/);
    assert.match(workflow, /classroompath-release-bundle\.json/);
    assert.match(workflow, /scripts\/release-bundle\.mjs verify/);
    assert.match(workflow, /scripts\/verify-openpath-promotion-contract\.mjs/);
    assert.match(
      workflow,
      /--contract-file openpath-promotion-contract-input\/openpath-promotion-contract\.json/
    );
    assert.doesNotMatch(workflow, /scripts\/resolve-openpath-linux-agent-version\.mjs/);
    assert.doesNotMatch(workflow, /scripts\/resolve-latest-verifier-image\.mjs/);
    assert.match(workflow, /contract_sha256/);
    assert.doesNotMatch(workflow, /candidateOpenpathShas/);
  });

  test('nightly staging carries the exact bundle identity into deployment', () => {
    const workflow = readProjectText('.github/workflows/nightly-staging-candidate.yml');

    assert.match(workflow, /wait-for-release-candidate\.mjs resolve-bundle/u);
    assert.doesNotMatch(workflow, /wait-for-release-candidate\.mjs resolve-manifest/u);
    assert.match(workflow, /--output-dir release-bundle/u);
    assert.match(workflow, /STAGING_RELEASE_ID=/u);
    assert.match(workflow, /STAGING_RELEASE_RUN_ID=/u);
  });

  test('OpenPath installability comes from the exact SHA systemd contract check', () => {
    const releaseCandidate = readProjectWorkflow('.github/workflows/release-candidate-images.yml');
    const sync = readProjectWorkflow('.github/workflows/sync-openpath.yml');
    const expectedChecks =
      'PublishPrereleasetoAPTRepository/PublishtoAPTRepository(unstable),InstallerContractsSuccess';

    for (const [label, workflow, jobName, stepName] of [
      [
        'release candidate',
        releaseCandidate,
        'verify-openpath-prerelease-apt',
        'Wait for OpenPath prerelease APT publish',
      ],
      ['OpenPath sync', sync, 'sync', 'Verify OpenPath upstream checks'],
    ] as const) {
      const step = workflow.jobs?.[jobName]?.steps?.find(
        (candidate) => candidate.name === stepName
      );
      const env = step?.env ?? {};
      assert.equal(
        String(env.OPENPATH_REQUIRED_CHECKS ?? '').replace(/\s+/gu, ''),
        expectedChecks,
        `${label} must require the exact OpenPath installer contract check`
      );
    }

    const releaseCandidateText = readProjectText('.github/workflows/release-candidate-images.yml');
    assert.match(releaseCandidateText, /scripts\/verify-openpath-promotion-contract\.mjs/u);
    assert.match(
      releaseCandidateText,
      /--openpath-manifest-file upstream\/openpath\/firefox-extension\/manifest\.json/u
    );
    assert.doesNotMatch(releaseCandidateText, /--install-probe-script/u);
    assert.doesNotMatch(releaseCandidateText, /docker run --rm -i ubuntu:24\.04 bash/u);

    const syncText = readProjectText('.github/workflows/sync-openpath.yml');
    assert.match(syncText, /scripts\/verify-openpath-promotion-contract\.mjs/u);
    assert.match(
      syncText,
      /git -C upstream\/openpath show[\s\S]*steps\.check\.outputs\.latest[^\n]*:firefox-extension\/manifest\.json/u
    );
    assert.match(syncText, /--openpath-manifest-file "\$manifest_file"/u);
    assert.doesNotMatch(syncText, /--install-probe-script/u);
    assert.doesNotMatch(syncText, /docker run --rm -i ubuntu:24\.04 bash/u);
  });
});
