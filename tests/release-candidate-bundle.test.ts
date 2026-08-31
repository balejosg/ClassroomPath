import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReleaseCandidateBundleArtifactName,
  buildReleaseCandidateBundleRuntimeProjection,
  selectExactReleaseCandidateRun,
} from '../scripts/lib/release-candidate-bundle.mjs';

const targetSha = 'a'.repeat(40);
const contractSha256 = 'c'.repeat(64);

describe('Release Candidate Bundle v2 locator', () => {
  test('names the immutable bundle artifact from the exact ClassroomPath SHA', () => {
    assert.equal(buildReleaseCandidateBundleArtifactName(targetSha), `release-bundle-${targetSha}`);
  });

  test('selects only a successful push run whose head SHA is exact', () => {
    assert.deepEqual(
      selectExactReleaseCandidateRun(
        [
          {
            databaseId: 9,
            headSha: 'f'.repeat(40),
            event: 'push',
            status: 'completed',
            conclusion: 'success',
          },
          {
            databaseId: 10,
            headSha: targetSha,
            event: 'push',
            status: 'completed',
            conclusion: 'success',
          },
        ],
        targetSha
      ),
      {
        databaseId: 10,
        headSha: targetSha,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
      }
    );

    assert.throws(
      () =>
        selectExactReleaseCandidateRun(
          [
            {
              databaseId: 10,
              headSha: 'f'.repeat(40),
              event: 'push',
              status: 'completed',
              conclusion: 'success',
            },
          ],
          targetSha
        ),
      /No successful release candidate run exists for exact SHA/
    );
  });

  test('can pin selection to the RC run locator instead of choosing a newer run for the same SHA', () => {
    const runs = [
      {
        databaseId: 10,
        headSha: targetSha,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-08-31T10:00:00Z',
      },
      {
        databaseId: 11,
        headSha: targetSha,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-08-31T11:00:00Z',
      },
    ];

    assert.equal(selectExactReleaseCandidateRun(runs, targetSha, { runId: '10' }).databaseId, 10);
    assert.throws(
      () => selectExactReleaseCandidateRun(runs, targetSha, { runId: '12' }),
      /No successful release candidate run exists for exact SHA/u
    );
  });

  test('projects a verified bundle identity into runtime values', () => {
    const projection = buildReleaseCandidateBundleRuntimeProjection({
      bundle: {
        schemaVersion: 2,
        classroomPathSha: targetSha,
        openPath: { sourceSha: 'd'.repeat(40), contractSha256 },
        images: {
          gateway: 'ghcr.io/example/gateway@sha256:' + '1'.repeat(64),
          migrations: 'ghcr.io/example/migrations@sha256:' + '2'.repeat(64),
          openpathFirefoxAssets: 'ghcr.io/example/firefox@sha256:' + '3'.repeat(64),
          openpathApi: 'ghcr.io/example/api@sha256:' + '4'.repeat(64),
          spa: 'ghcr.io/example/spa@sha256:' + '5'.repeat(64),
          verifier: 'ghcr.io/example/verifier@sha256:' + '6'.repeat(64),
        },
      },
      contract: {
        schemaVersion: 2,
        openpathSha: 'd'.repeat(40),
        openpathVersion: '4.1.0',
        interfaces: { wrapperIntegration: 1, windowsOfflineInstaller: 1, readiness: 1 },
        components: {
          linuxAgent: {
            sourceSha: 'd'.repeat(40),
            inputsSha256: '7'.repeat(64),
            packageName: 'openpath-dnsmasq',
            packageVersion: '0.0.1-1',
            aptSuite: 'unstable',
            filename: 'pool/unstable/main/openpath-dnsmasq_0.0.1-1_amd64.deb',
            sha256: '8'.repeat(64),
          },
          windowsOfflineInstaller: {
            sourceSha: 'd'.repeat(40),
            inputsSha256: '9'.repeat(64),
            version: '4.1.0',
            releaseTag: 'scripts-v4.1.0-ddddddd',
            templateAsset: 'OpenPath-Windows-Setup-Template.exe',
            templateSha256: 'a'.repeat(64),
            payloadManifestAsset: 'payload-manifest.json',
            payloadManifestSha256: 'b'.repeat(64),
          },
          browserPolicy: {
            sourceSha: 'd'.repeat(40),
            inputsSha256: 'c'.repeat(64),
            firefoxExtensionVersion: '2.0.1',
            browserPolicySpecSha256: 'e'.repeat(64),
          },
        },
      },
    });

    assert.match(projection.RELEASE_ID, /^[0-9a-f]{64}$/);
    assert.equal(projection.APP_SHA, targetSha);
    assert.equal(projection.OPENPATH_SHA, 'd'.repeat(40));
    assert.equal(projection.OPENPATH_CONTRACT_SHA256, contractSha256);
    assert.match(projection.CLASSROOMPATH_GATEWAY_IMAGE, /@sha256:/);
  });
});
