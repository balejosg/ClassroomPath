import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildStagingReleasePlan,
  formatStagingReleasePlanEnv,
  parseReleaseManifestText,
} from '../scripts/lib/release-plan.mjs';

describe('staging release plan', () => {
  const manifestText = `
repository=balejosg/ClassroomPath
run_id=24006418074
app_sha=0123456789abcdef0123456789abcdef01234567
gateway_image=ghcr.io/balejosg/classroompath-gateway@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
migrations_image=ghcr.io/balejosg/classroompath-migrations@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
openpath_firefox_assets_image=ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
openpath_api_image=ghcr.io/balejosg/openpath-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
openpath_version=4.1.11
linux_agent_version=4.1.11-1
linux_agent_apt_suite=unstable
spa_image=ghcr.io/balejosg/classroompath-spa@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
verifier_image=ghcr.io/balejosg/classroompath-verifier@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
`.trim();

  test('builds a typed release-candidate plan from the manifest contract', () => {
    const manifest = parseReleaseManifestText(manifestText);
    const plan = buildStagingReleasePlan({
      imageMode: 'release-candidate',
      remoteSha: '0123456789abcdef0123456789abcdef01234567',
      manifest,
    });

    assert.equal(plan.imageSource, 'release-candidate');
    assert.equal(plan.deploymentMode, 'promotion-eligible');
    assert.equal(plan.useReleaseCandidate, true);
    assert.equal(plan.targetSha, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(plan.releaseCandidate?.runId, '24006418074');
    assert.equal(
      plan.releaseCandidate?.openpathFirefoxAssetsImage,
      'ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    );
    assert.equal(plan.releaseCandidate?.openpathVersion, '4.1.11');
    assert.equal(plan.releaseCandidate?.linuxAgentVersion, '4.1.11-1');
    assert.equal(plan.releaseCandidate?.linuxAgentAptSuite, 'unstable');
    assert.equal(plan.verification.runSmoke, true);
    assert.equal(plan.verification.runReleaseGate, true);
    assert.equal(plan.verification.persistEvidence, true);
    assert.equal(plan.verification.requireLiveWindowsFirefoxEvidence, true);
  });

  test('rejects release-candidate manifests for a different app sha', () => {
    const manifest = parseReleaseManifestText(manifestText);

    assert.throws(
      () =>
        buildStagingReleasePlan({
          imageMode: 'release-candidate',
          remoteSha: '89abcdef0123456789abcdef0123456789abcdef',
          manifest,
        }),
      /release-candidate manifest APP_SHA does not match target SHA/
    );
  });

  test('renders shell env assignments from the typed plan', () => {
    const manifest = parseReleaseManifestText(manifestText);
    const plan = buildStagingReleasePlan({
      imageMode: 'release-candidate',
      remoteSha: '0123456789abcdef0123456789abcdef01234567',
      manifest,
    });
    const rendered = formatStagingReleasePlanEnv(plan);

    assert.match(rendered, /STAGING_IMAGE_SOURCE=release-candidate/);
    assert.match(rendered, /STAGING_DEPLOYMENT_MODE=promotion-eligible/);
    assert.match(rendered, /STAGING_USE_RELEASE_CANDIDATE=1/);
    assert.match(rendered, /STAGING_RELEASE_SHA=0123456789abcdef0123456789abcdef01234567/);
    assert.match(rendered, /STAGING_RELEASE_RUN_ID=24006418074/);
    assert.match(rendered, /STAGING_RELEASE_REPOSITORY=balejosg\/ClassroomPath/);
    assert.match(rendered, /STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE=1/);
  });

  test('falls back to source-build planning without a manifest', () => {
    const plan = buildStagingReleasePlan({
      imageMode: 'source-build',
      remoteSha: '89abcdef0123456789abcdef0123456789abcdef',
      manifest: null,
    });

    assert.equal(plan.imageSource, 'source-build');
    assert.equal(plan.deploymentMode, 'debug');
    assert.equal(plan.useReleaseCandidate, false);
    assert.equal(plan.targetSha, '89abcdef0123456789abcdef0123456789abcdef');
    assert.equal(plan.releaseCandidate, null);
    assert.equal(plan.verification.runReleaseGate, false);
    assert.equal(plan.verification.persistEvidence, false);
    assert.equal(plan.verification.requireLiveWindowsFirefoxEvidence, false);
  });

  test('renders source-build env assignments with promotion evidence disabled', () => {
    const plan = buildStagingReleasePlan({
      imageMode: 'source-build',
      remoteSha: '89abcdef0123456789abcdef0123456789abcdef',
      manifest: null,
    });
    const rendered = formatStagingReleasePlanEnv(plan);

    assert.match(rendered, /STAGING_DEPLOYMENT_MODE=debug/);
    assert.match(rendered, /STAGING_RELEASE_REPOSITORY=/);
  });
});
