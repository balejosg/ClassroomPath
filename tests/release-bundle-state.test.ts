import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'node:test';

import { buildReleaseBundle, buildReleaseBundleArtifacts } from '../scripts/lib/release-bundle.mjs';
import {
  activateReleaseState,
  buildReleaseStatePaths,
  capturePreviousReleaseState,
  persistReleaseStateRelease,
  readReleaseStateAtPointer,
  readReleaseStatePointer,
  readActiveReleaseState,
} from '../scripts/lib/release-bundle-state.mjs';

const tempDirs: string[] = [];
const classroomPathSha = 'a'.repeat(40);
const openpathSha = 'b'.repeat(40);

function contract() {
  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion: '4.1.0',
    interfaces: { wrapperIntegration: 1, windowsOfflineInstaller: 1, readiness: 1 },
    components: {
      linuxAgent: {
        sourceSha: openpathSha,
        inputsSha256: '1'.repeat(64),
        packageName: 'openpath-dnsmasq',
        packageVersion: '0.0.1-1',
        aptSuite: 'unstable',
        filename: 'pool/unstable/main/openpath-dnsmasq_0.0.1-1_amd64.deb',
        sha256: '2'.repeat(64),
      },
      windowsOfflineInstaller: {
        sourceSha: openpathSha,
        inputsSha256: '3'.repeat(64),
        version: '4.1.0',
        releaseTag: 'scripts-v4.1.0-bbbbbbb',
        templateAsset: 'OpenPath-Windows-Setup-Template.exe',
        templateSha256: '4'.repeat(64),
        payloadManifestAsset: 'payload-manifest.json',
        payloadManifestSha256: '5'.repeat(64),
      },
      browserPolicy: {
        sourceSha: openpathSha,
        inputsSha256: '6'.repeat(64),
        firefoxExtensionVersion: '2.0.1',
        browserPolicySpecSha256: '7'.repeat(64),
      },
    },
  };
}

function release(seed: string) {
  const exactContractBytes = Buffer.from(JSON.stringify(contract(), null, 2) + '\n');
  const contractSha256 = createHash('sha256').update(exactContractBytes).digest('hex');
  const bundle = buildReleaseBundle({
    classroomPathSha: seed.repeat(40).slice(0, 40),
    openPath: { sourceSha: openpathSha, contractSha256 },
    images: Object.fromEntries(
      [
        ['gateway', '1'],
        ['migrations', '2'],
        ['openpathFirefoxAssets', '3'],
        ['openpathApi', '4'],
        ['spa', '5'],
        ['verifier', '6'],
      ].map(([name, digest]) => [name, 'ghcr.io/example/' + name + '@sha256:' + digest.repeat(64)])
    ),
  });
  return buildReleaseBundleArtifacts({ bundle, contractBytes: exactContractBytes });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true });
  }
});

describe('Release Bundle v2 persistent state', () => {
  test('stores exact artifacts under releaseId and activates atomic current/previous pointers', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'classroompath-release-state-v2-'));
    tempDirs.push(stateRoot);
    const first = release('c');
    const second = release('d');

    persistReleaseStateRelease({ stateRoot, verified: first, rcRunId: '123' });
    const firstPaths = buildReleaseStatePaths(stateRoot, first.releaseId);
    assert.equal(readFileSync(firstPaths.bundlePath, 'utf8'), first.bundleBytes.toString('utf8'));
    assert.equal(
      readFileSync(firstPaths.contractPath, 'utf8'),
      first.contractBytes.toString('utf8')
    );
    assert.equal(existsSync(firstPaths.runtimePath), true);
    assert.match(readFileSync(firstPaths.runtimePath, 'utf8'), /RC_RUN_ID=123\n/);

    activateReleaseState({ stateRoot, releaseId: first.releaseId });
    assert.equal(readFileSync(join(stateRoot, 'current'), 'utf8'), first.releaseId + '\n');
    assert.equal(existsSync(join(stateRoot, 'previous')), false);

    persistReleaseStateRelease({ stateRoot, verified: second });
    assert.throws(
      () =>
        activateReleaseState({
          stateRoot,
          releaseId: second.releaseId,
          readinessCheck: () => {
            throw new Error('readiness failed');
          },
        }),
      /readiness failed/
    );
    assert.equal(readFileSync(join(stateRoot, 'current'), 'utf8'), first.releaseId + '\n');
    assert.equal(existsSync(join(stateRoot, 'previous')), false);

    activateReleaseState({ stateRoot, releaseId: second.releaseId });
    assert.equal(readFileSync(join(stateRoot, 'current'), 'utf8'), second.releaseId + '\n');
    assert.equal(readFileSync(join(stateRoot, 'previous'), 'utf8'), first.releaseId + '\n');
    assert.equal(readActiveReleaseState({ stateRoot }).releaseId, second.releaseId);
  });

  test('rejects a tampered stored bundle before activation', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'classroompath-release-state-v2-tamper-'));
    tempDirs.push(stateRoot);
    const verified = release('e');
    persistReleaseStateRelease({ stateRoot, verified });
    const paths = buildReleaseStatePaths(stateRoot, verified.releaseId);
    writeFileSync(paths.bundlePath, Buffer.from('tampered\n'));

    assert.throws(
      () => activateReleaseState({ stateRoot, releaseId: verified.releaseId }),
      /invalid Release Bundle v2 JSON/
    );
    assert.equal(existsSync(join(stateRoot, 'current')), false);
  });

  test('rejects a tampered runtime projection before activation', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'classroompath-release-state-v2-runtime-'));
    tempDirs.push(stateRoot);
    const verified = release('6');
    persistReleaseStateRelease({ stateRoot, verified, rcRunId: '456' });
    const paths = buildReleaseStatePaths(stateRoot, verified.releaseId);
    writeFileSync(
      paths.runtimePath,
      readFileSync(paths.runtimePath, 'utf8').replace(
        `OPENPATH_SHA=${openpathSha}`,
        `OPENPATH_SHA=${'c'.repeat(40)}`
      )
    );

    assert.throws(
      () => activateReleaseState({ stateRoot, releaseId: verified.releaseId }),
      /stored Release Bundle v2 runtime projection differs/
    );
    assert.equal(existsSync(join(stateRoot, 'current')), false);
  });

  test('reads and verifies the exact previous release through its content-addressed pointer', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'classroompath-release-state-v2-pointer-'));
    tempDirs.push(stateRoot);
    const first = release('f');
    const second = release('9');

    persistReleaseStateRelease({ stateRoot, verified: first });
    activateReleaseState({ stateRoot, releaseId: first.releaseId });
    persistReleaseStateRelease({ stateRoot, verified: second });
    activateReleaseState({ stateRoot, releaseId: second.releaseId });

    assert.equal(readReleaseStatePointer({ stateRoot, pointer: 'previous' }), first.releaseId);
    const previous = readReleaseStateAtPointer({ stateRoot, pointer: 'previous' });
    assert.equal(previous.releaseId, first.releaseId);
    assert.equal(previous.bundle.classroomPathSha, first.bundle.classroomPathSha);
    assert.equal(previous.contractSha256, first.contractSha256);
  });

  test('captures the active release as previous before a pending deployment mutates runtime', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'classroompath-release-state-v2-capture-'));
    tempDirs.push(stateRoot);
    const first = release('8');
    const second = release('7');

    persistReleaseStateRelease({ stateRoot, verified: first, rcRunId: '100' });
    activateReleaseState({ stateRoot, releaseId: first.releaseId });
    persistReleaseStateRelease({ stateRoot, verified: second, rcRunId: '200' });

    const captured = capturePreviousReleaseState({ stateRoot });
    assert.equal(captured?.releaseId, first.releaseId);
    assert.equal(readReleaseStatePointer({ stateRoot, pointer: 'current' }), first.releaseId);
    assert.equal(readReleaseStatePointer({ stateRoot, pointer: 'previous' }), first.releaseId);

    activateReleaseState({ stateRoot, releaseId: second.releaseId });
    assert.equal(readReleaseStatePointer({ stateRoot, pointer: 'current' }), second.releaseId);
    assert.equal(readReleaseStatePointer({ stateRoot, pointer: 'previous' }), first.releaseId);
  });
});
