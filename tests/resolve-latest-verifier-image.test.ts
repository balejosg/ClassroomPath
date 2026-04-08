import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReleaseManifestScenario,
  buildReleaseFixtureScenario,
} from './helpers/release-fixtures.ts';
import {
  buildLatestVerifierImageOutputs,
  resolveLatestVerifierImageData,
} from '../scripts/lib/resolve-latest-verifier-image.mjs';

describe('resolve latest verifier image', () => {
  test('resolves the latest verifier image outputs from workflow runs and manifest content', () => {
    const resolved = resolveLatestVerifierImageData({
      manifestContent: buildReleaseManifestScenario().replaceAll('target-sha', 'newer-sha'),
      runs: buildReleaseFixtureScenario('latest-success'),
    });

    assert.deepEqual(buildLatestVerifierImageOutputs(resolved), {
      run_id: '402',
      head_sha: 'newer-sha',
      gateway_image: 'ghcr.io/balejosg/classroompath-gateway@sha256:1',
      migrations_image: 'ghcr.io/balejosg/classroompath-migrations@sha256:2',
      openpath_api_image: 'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
      linux_agent_version: '4.1.3',
      spa_image: 'ghcr.io/balejosg/classroompath-spa@sha256:4',
      verifier_image: 'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
    });
  });
});
