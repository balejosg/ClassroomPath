import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReleaseManifestScenario,
  buildReleaseFixtureScenario,
} from './helpers/release-fixtures.ts';
import { resolveLatestSuccessfulReleaseCandidateManifest } from '../scripts/wait-for-release-candidate.mjs';
import {
  buildLatestVerifierImageOutputs,
  resolveLatestVerifierImageData,
} from '../scripts/lib/resolve-latest-verifier-image.mjs';

describe('resolve latest verifier image', () => {
  test('resolves the latest verifier image outputs from the canonical release-candidate manifest shape', () => {
    const releaseCandidate = resolveLatestSuccessfulReleaseCandidateManifest({
      repository: 'balejosg/ClassroomPath',
      manifestContent: buildReleaseManifestScenario().replaceAll('target-sha', 'newer-sha'),
      runs: buildReleaseFixtureScenario('latest-success'),
    });
    const resolved = resolveLatestVerifierImageData(releaseCandidate);

    assert.deepEqual(buildLatestVerifierImageOutputs(resolved), {
      run_id: '402',
      head_sha: 'newer-sha',
      gateway_image: 'ghcr.io/balejosg/classroompath-gateway@sha256:1',
      migrations_image: 'ghcr.io/balejosg/classroompath-migrations@sha256:2',
      openpath_firefox_assets_image:
        'ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:6',
      openpath_api_image: 'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
      openpath_version: '4.1.3',
      linux_agent_version: '4.1.3',
      linux_agent_apt_suite: 'unstable',
      spa_image: 'ghcr.io/balejosg/classroompath-spa@sha256:4',
      verifier_image: 'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
    });
  });

  test('exposes the complete previous Windows offline-installer pin without changing it', () => {
    const windowsPin = {
      windows_offline_installer_template_version: '4.1.0',
      windows_offline_installer_template_commit: '0123456789abcdef0123456789abcdef01234567',
      windows_offline_installer_template_release_tag: 'scripts-v4.1.0-0123456',
      windows_offline_installer_template_sha256:
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    };
    const releaseCandidate = resolveLatestSuccessfulReleaseCandidateManifest({
      repository: 'balejosg/ClassroomPath',
      manifestContent: `${buildReleaseManifestScenario().replaceAll('target-sha', 'newer-sha')}${Object.entries(
        windowsPin
      )
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
      runs: buildReleaseFixtureScenario('latest-success'),
    });

    const outputs = buildLatestVerifierImageOutputs(
      resolveLatestVerifierImageData(releaseCandidate)
    );

    assert.deepEqual(
      Object.fromEntries(
        Object.keys(windowsPin).map((key) => [key, outputs[key as keyof typeof outputs]])
      ),
      windowsPin
    );
  });
});
