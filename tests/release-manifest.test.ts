import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildReleaseManifestScenario } from './helpers/release-fixtures.ts';
import {
  normalizeReleaseManifestText,
  parseCanonicalReleaseManifestText,
  serializeReleaseManifest,
} from '../scripts/lib/release-manifest.mjs';

describe('release manifest normalization', () => {
  test('normalizes raw release-candidate artifact output into the canonical manifest contract', () => {
    const canonical = normalizeReleaseManifestText(buildReleaseManifestScenario(), {
      repository: 'balejosg/ClassroomPath',
      runId: '24006418074',
      sha: 'target-sha',
    });

    assert.deepEqual(canonical, {
      repository: 'balejosg/ClassroomPath',
      run_id: '24006418074',
      app_sha: 'target-sha',
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

  test('round-trips canonical manifests through serialization', () => {
    const canonical = normalizeReleaseManifestText(buildReleaseManifestScenario(), {
      repository: 'balejosg/ClassroomPath',
      runId: '24006418074',
      sha: 'target-sha',
    });
    const serialized = serializeReleaseManifest(canonical);

    assert.deepEqual(parseCanonicalReleaseManifestText(serialized), canonical);
    assert.match(serialized, /^repository=balejosg\/ClassroomPath$/m);
    assert.match(serialized, /^run_id=24006418074$/m);
    assert.match(serialized, /^app_sha=target-sha$/m);
    assert.match(serialized, /^linux_agent_apt_suite=unstable$/m);
  });

  test('preserves the pinned Windows offline-installer release metadata', () => {
    const raw = `${buildReleaseManifestScenario()}
windows_offline_installer_template_version=4.1.0
windows_offline_installer_template_commit=0123456789abcdef0123456789abcdef01234567
windows_offline_installer_template_release_tag=scripts-v4.1.0-0123456
windows_offline_installer_template_sha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
`;
    const canonical = normalizeReleaseManifestText(raw, {
      repository: 'balejosg/ClassroomPath',
      runId: '24006418074',
      sha: 'target-sha',
    });
    const serialized = serializeReleaseManifest(canonical);

    assert.equal(canonical.windows_offline_installer_template_version, '4.1.0');
    assert.match(serialized, /^windows_offline_installer_template_commit=0123456/m);
    assert.match(serialized, /^windows_offline_installer_template_sha256=abcdef0/m);
    assert.deepEqual(parseCanonicalReleaseManifestText(serialized), canonical);
  });

  test('rejects a partial Windows offline-installer release pin', () => {
    assert.throws(
      () =>
        normalizeReleaseManifestText(
          `${buildReleaseManifestScenario()}\nwindows_offline_installer_template_version=4.1.0\n`,
          { repository: 'balejosg/ClassroomPath', runId: '24006418074', sha: 'target-sha' }
        ),
      /complete Windows offline installer pin/
    );
  });
});
