import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_BUNDLE_IMAGE_NAMES,
  buildReleaseBundle,
  buildReleaseBundleArtifacts,
  calculateReleaseId,
  projectOpenPathContractToLegacyRuntime,
  serializeReleaseBundle,
  shouldRebuildOpenPathDerivedImages,
  validateReleaseBundle,
  verifyReleaseBundleArtifacts,
} from '../scripts/lib/release-bundle.mjs';

const classroomPathSha = '1111111111111111111111111111111111111111';
const openpathSha = 'a3846d6cbbb5c816d12dc4c5a60409760e121b90';
const contractSha256 = '2222222222222222222222222222222222222222222222222222222222222222';
const digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseBundleScriptPath = resolve(projectRoot, 'scripts/release-bundle.mjs');

function imageRefs() {
  return Object.fromEntries(
    RELEASE_BUNDLE_IMAGE_NAMES.map((name) => [
      name,
      'ghcr.io/balejosg/classroompath-' + name + '@sha256:' + digest,
    ])
  );
}

function buildBundle(overrides: Record<string, unknown> = {}) {
  return buildReleaseBundle({
    classroomPathSha,
    openPath: { sourceSha: openpathSha, contractSha256 },
    images: imageRefs(),
    ...overrides,
  });
}

function buildContract() {
  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion: '4.1.0',
    interfaces: {
      wrapperIntegration: 1,
      windowsOfflineInstaller: 1,
      readiness: 1,
    },
    components: {
      linuxAgent: {
        sourceSha: openpathSha,
        inputsSha256: contractSha256,
        packageName: 'openpath-dnsmasq',
        packageVersion: '0.0.20260830211724-1',
        aptSuite: 'unstable',
        filename: 'pool/unstable/main/openpath-dnsmasq_0.0.20260830211724-1_amd64.deb',
        sha256: contractSha256,
      },
      windowsOfflineInstaller: {
        sourceSha: openpathSha,
        inputsSha256: contractSha256,
        version: '4.1.0',
        releaseTag: 'scripts-v4.1.0-a3846d6',
        templateAsset: 'OpenPath-Windows-Setup-Template.exe',
        templateSha256: contractSha256,
        payloadManifestAsset: 'payload-manifest.json',
        payloadManifestSha256: contractSha256,
      },
      browserPolicy: {
        sourceSha: openpathSha,
        inputsSha256: contractSha256,
        firefoxExtensionVersion: '2.0.1',
        browserPolicySpecSha256: contractSha256,
      },
    },
  };
}

function exactContractBytes() {
  return Buffer.from(JSON.stringify(buildContract(), null, 2) + '\n', 'utf8');
}

describe('Release Bundle v2', () => {
  test('serializes the strict bundle in deterministic canonical order', () => {
    const bundle = buildBundle();
    const expected = {
      schemaVersion: 2,
      classroomPathSha,
      openPath: { sourceSha: openpathSha, contractSha256 },
      images: imageRefs(),
    };

    assert.deepEqual(bundle, expected);
    assert.equal(serializeReleaseBundle(bundle), JSON.stringify(expected, null, 2) + '\n');
  });

  test('defines releaseId as SHA-256 of the exact serialized bundle bytes', () => {
    const bytes = Buffer.from(serializeReleaseBundle(buildBundle()), 'utf8');

    assert.equal(calculateReleaseId(bytes), createHash('sha256').update(bytes).digest('hex'));
    assert.equal(calculateReleaseId(buildBundle()), calculateReleaseId(bytes));
    assert.match(calculateReleaseId(bytes), /^[0-9a-f]{64}$/);
  });

  test('requires every named image to be an immutable OCI digest reference', () => {
    assert.throws(
      () =>
        buildBundle({
          images: { ...imageRefs(), gateway: 'ghcr.io/example/gateway:latest' },
        }),
      /images.gateway must be an OCI repository@sha256 digest reference/
    );

    const missingImageRefs = { ...imageRefs() } as Record<string, string>;
    delete missingImageRefs.verifier;
    assert.throws(() => buildBundle({ images: missingImageRefs }), /images.verifier is required/);
  });

  test('rejects invalid identity fields and volatile or unknown bundle properties', () => {
    assert.throws(
      () => buildBundle({ classroomPathSha: 'not-a-sha' }),
      /classroomPathSha must be a 40-character lowercase SHA/
    );
    assert.throws(
      () =>
        buildBundle({
          openPath: { sourceSha: openpathSha, contractSha256: 'not-a-hash' },
        }),
      /openPath.contractSha256 must be a 64-character lowercase SHA-256 hex string/
    );
    assert.throws(
      () => validateReleaseBundle({ ...buildBundle(), releaseId: 'mutable' }),
      /bundle contains unknown property releaseId/
    );
    assert.throws(
      () => validateReleaseBundle({ ...buildBundle(), timestamp: '2026-08-31T00:00:00Z' }),
      /bundle contains unknown property timestamp/
    );
  });

  test('uses only contract bytes hash for OpenPath-derived image reuse', () => {
    assert.equal(
      shouldRebuildOpenPathDerivedImages({
        previousContractSha256: contractSha256,
        currentContractSha256: contractSha256,
      }),
      false
    );
    assert.equal(
      shouldRebuildOpenPathDerivedImages({
        previousContractSha256: '3333333333333333333333333333333333333333333333333333333333333333',
        currentContractSha256: contractSha256,
      }),
      true
    );
    assert.equal(
      shouldRebuildOpenPathDerivedImages({
        previousContractSha256: '',
        currentContractSha256: contractSha256,
      }),
      true
    );
  });

  test('binds the bundle to the exact contract bytes and verifies both hashes', () => {
    const contractBytes = exactContractBytes();
    const bundle = buildBundle({
      openPath: {
        sourceSha: openpathSha,
        contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
      },
    });
    const artifact = buildReleaseBundleArtifacts({ bundle, contractBytes });
    const verified = verifyReleaseBundleArtifacts({
      bundleBytes: artifact.bundleBytes,
      contractBytes,
      expectedReleaseId: artifact.releaseId,
      expectedClassroomPathSha: classroomPathSha,
    });

    assert.equal(verified.releaseId, artifact.releaseId);
    assert.deepEqual(verified.contract, buildContract());
    assert.deepEqual(verified.contractBytes, contractBytes);
    assert.throws(
      () =>
        buildReleaseBundleArtifacts({
          bundle,
          contractBytes: Buffer.concat([contractBytes, Buffer.from('\n')]),
        }),
      /contractSha256 does not match the exact OpenPath contract bytes/
    );
  });

  test('executes the CLI when invoked through a symlinked deployment path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-release-bundle-cli-'));
    try {
      const contractBytes = exactContractBytes();
      const bundle = buildBundle({
        openPath: {
          sourceSha: openpathSha,
          contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
        },
      });
      const bundleBytes = Buffer.from(serializeReleaseBundle(bundle), 'utf8');
      const releaseId = calculateReleaseId(bundleBytes);
      const bundlePath = join(tempDir, 'bundle.json');
      const contractPath = join(tempDir, 'contract.json');
      const outputEnvPath = join(tempDir, 'runtime.env');
      const symlinkPath = join(tempDir, 'release-bundle.mjs');

      writeFileSync(bundlePath, bundleBytes);
      writeFileSync(contractPath, contractBytes);
      symlinkSync(releaseBundleScriptPath, symlinkPath);

      execFileSync(
        process.execPath,
        [
          symlinkPath,
          'verify',
          '--bundle-file',
          bundlePath,
          '--contract-file',
          contractPath,
          '--release-id',
          releaseId,
          '--classroompath-sha',
          classroomPathSha,
          '--output-env',
          outputEnvPath,
        ],
        { encoding: 'utf8' }
      );

      const runtimeEnv = readFileSync(outputEnvPath, 'utf8');
      assert.match(runtimeEnv, new RegExp(`^RELEASE_ID=${releaseId}$`, 'm'));
      assert.match(runtimeEnv, new RegExp(`^APP_SHA=${classroomPathSha}$`, 'm'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('projects the upstream Linux version while preserving the Debian package version', () => {
    const contract = buildContract();

    assert.equal(contract.components.linuxAgent.packageVersion, '0.0.20260830211724-1');
    assert.deepEqual(
      projectOpenPathContractToLegacyRuntime({
        contract,
        contractSha256,
      }),
      {
        OPENPATH_SHA: openpathSha,
        OPENPATH_CONTRACT_SHA256: contractSha256,
        OPENPATH_VERSION: '4.1.0',
        OPENPATH_LINUX_AGENT_VERSION: '0.0.20260830211724',
        OPENPATH_LINUX_AGENT_APT_SUITE: 'unstable',
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION: '4.1.0',
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: openpathSha,
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG: 'scripts-v4.1.0-a3846d6',
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256: contractSha256,
      }
    );
  });
});
