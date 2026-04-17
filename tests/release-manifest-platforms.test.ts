import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  listReleaseManifestImages,
  manifestSupportsPlatform,
  verifyReleaseManifestPlatforms,
} from '../scripts/verify-release-manifest-platforms.mjs';

const releaseManifest = [
  'repository=balejosg/ClassroomPath',
  'run_id=123',
  'app_sha=abcdef',
  'gateway_image=ghcr.io/balejosg/classroompath-gateway@sha256:1',
  'migrations_image=ghcr.io/balejosg/classroompath-migrations@sha256:2',
  'openpath_api_image=ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
  'openpath_version=4.1.25',
  'linux_agent_version=4.1.25',
  'linux_agent_apt_suite=stable',
  'spa_image=ghcr.io/balejosg/classroompath-spa@sha256:4',
  'verifier_image=ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
  '',
].join('\n');

const manifestList = {
  manifests: [
    { platform: { os: 'linux', architecture: 'amd64' }, digest: 'sha256:amd64' },
    { platform: { os: 'linux', architecture: 'arm64' }, digest: 'sha256:arm64' },
  ],
};

describe('release manifest platform verifier', () => {
  test('lists every runtime image from the canonical release manifest', () => {
    assert.deepEqual(listReleaseManifestImages(releaseManifest), [
      'ghcr.io/balejosg/classroompath-gateway@sha256:1',
      'ghcr.io/balejosg/classroompath-migrations@sha256:2',
      'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
      'ghcr.io/balejosg/classroompath-spa@sha256:4',
      'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
    ]);
  });

  test('accepts OCI manifest lists that contain the requested target platform', () => {
    assert.equal(manifestSupportsPlatform(manifestList, 'linux/arm64'), true);
    assert.equal(manifestSupportsPlatform(manifestList, 'linux/amd64'), true);
  });

  test('rejects manifests that do not contain the requested target platform', () => {
    assert.equal(
      manifestSupportsPlatform(
        { manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }] },
        'linux/arm64'
      ),
      false
    );
  });

  test('fails closed when any release image lacks the production target platform', async () => {
    await assert.rejects(
      verifyReleaseManifestPlatforms({
        manifestText: releaseManifest,
        targetPlatform: 'linux/arm64',
        inspectImage: async (image) =>
          image.includes('classroompath-spa')
            ? { manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }] }
            : manifestList,
      }),
      /classroompath-spa.*linux\/arm64/
    );
  });
});
