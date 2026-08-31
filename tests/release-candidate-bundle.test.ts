import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { describe, test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as releaseCandidateBundle from '../scripts/lib/release-candidate-bundle.mjs';

import {
  buildReleaseCandidateBundleArtifactName,
  buildReleaseCandidateBundleRuntimeProjection,
  selectExactReleaseCandidateRun,
  writeReleaseCandidateBundleRuntimeEnv,
} from '../scripts/lib/release-candidate-bundle.mjs';

const targetSha = 'a'.repeat(40);
const contractSha256 = 'c'.repeat(64);

type ArtifactReader = (options: {
  artifactDir: string;
  readFile: (input: { artifactDir: string; fileName: string }) => Buffer | string;
}) => {
  bundleBytes: Buffer;
  contractBytes: Buffer;
};

function readBundleFiles(files: Record<string, Buffer | string>) {
  const reader = Reflect.get(releaseCandidateBundle, 'readBundleFilesFromArtifact') as
    | ArtifactReader
    | undefined;
  assert.equal(
    typeof reader,
    'function',
    'the artifact layout resolver must be exported for regression coverage'
  );

  return reader!({
    artifactDir: '/fake/artifact',
    readFile: ({ fileName }) => {
      if (!Object.prototype.hasOwnProperty.call(files, fileName)) {
        const error = new Error(`missing ${fileName}`) as Error & { code?: string };
        error.code = 'ENOENT';
        throw error;
      }
      return files[fileName];
    },
  });
}

describe('Release Candidate Bundle v2 artifact layouts', () => {
  test('reads the complete canonical release-bundle pair', () => {
    const result = readBundleFiles({
      'release-bundle/classroompath-release-bundle.json': 'canonical bundle',
      'release-bundle/openpath-promotion-contract.json': 'canonical contract',
    });

    assert.equal(result.bundleBytes.toString(), 'canonical bundle');
    assert.equal(result.contractBytes.toString(), 'canonical contract');
  });

  test('reads the complete root pair as compatibility layout', () => {
    const result = readBundleFiles({
      'classroompath-release-bundle.json': 'root bundle',
      'openpath-promotion-contract.json': 'root contract',
    });

    assert.equal(result.bundleBytes.toString(), 'root bundle');
    assert.equal(result.contractBytes.toString(), 'root contract');
  });

  test('fails closed when neither layout contains a complete pair', () => {
    assert.throws(() => readBundleFiles({}), /No complete .*pair/u);
  });

  test('fails closed instead of mixing an incomplete canonical and root layout', () => {
    assert.throws(
      () =>
        readBundleFiles({
          'release-bundle/classroompath-release-bundle.json': 'canonical bundle',
          'openpath-promotion-contract.json': 'root contract',
        }),
      /No complete .*pair/u
    );
  });

  test('fails closed when complete canonical and root pairs conflict', () => {
    assert.throws(
      () =>
        readBundleFiles({
          'release-bundle/classroompath-release-bundle.json': 'canonical bundle',
          'release-bundle/openpath-promotion-contract.json': 'canonical contract',
          'classroompath-release-bundle.json': 'root bundle',
          'openpath-promotion-contract.json': 'root contract',
        }),
      /Ambiguous .*pair/u
    );
  });
});

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

  test('persists runtime keys containing digits', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'release-candidate-runtime-'));
    const outputPath = join(outputDir, 'runtime.env');

    try {
      writeReleaseCandidateBundleRuntimeEnv(outputPath, {
        APP_SHA: targetSha,
        OPENPATH_CONTRACT_SHA256: contractSha256,
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256: contractSha256,
      });

      const runtimeText = readFileSync(outputPath, 'utf8');
      assert.match(runtimeText, new RegExp(`^OPENPATH_CONTRACT_SHA256=${contractSha256}$`, 'm'));
      assert.match(
        runtimeText,
        new RegExp(`^OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=${contractSha256}$`, 'm')
      );
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
