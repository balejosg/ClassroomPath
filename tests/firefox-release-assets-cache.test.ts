import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  resolveFirefoxReleaseAssetCache,
  validateFirefoxReleaseAssetCache,
} from '../scripts/resolve-firefox-release-assets-cache.mjs';

const tempDirectories: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(dir);
  return dir;
}

function writeValidFirefoxReleaseCache(artifactDir: string, payloadHash: string): void {
  mkdirSync(join(artifactDir, 'build', 'firefox-release'), { recursive: true });
  writeFileSync(join(artifactDir, 'payload-hash.txt'), `${payloadHash}\n`);
  writeFileSync(
    join(artifactDir, 'build', 'firefox-release', 'metadata.json'),
    `${JSON.stringify({
      extensionId: 'monitor-bloqueos@openpath',
      version: '2.0.0.123',
      signatureSource: 'amo',
      signatureState: 'signed',
    })}\n`
  );
  writeFileSync(
    join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi'),
    'signed-xpi'
  );
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const dir = tempDirectories.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Firefox release asset cache validation', () => {
  test('accepts cached assets only when hash, metadata, and signed XPI are present', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    writeValidFirefoxReleaseCache(artifactDir, 'payload-sha');

    assert.deepEqual(
      validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      {
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.123',
        signatureSource: 'amo',
        signatureState: 'signed',
      }
    );
  });

  test('rejects cached assets without AMO signature metadata', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    mkdirSync(join(artifactDir, 'build', 'firefox-release'), { recursive: true });
    writeFileSync(join(artifactDir, 'payload-hash.txt'), 'payload-sha\n');
    writeFileSync(
      join(artifactDir, 'build', 'firefox-release', 'metadata.json'),
      `${JSON.stringify({ extensionId: 'monitor-bloqueos@openpath', version: '2.0.0.123' })}\n`
    );
    writeFileSync(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi'),
      'signed-xpi'
    );

    assert.throws(
      () => validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      /signatureSource/
    );
  });

  test('rejects cached assets when the payload hash does not match', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    writeValidFirefoxReleaseCache(artifactDir, 'payload-sha');

    assert.throws(
      () =>
        validateFirefoxReleaseAssetCache({
          artifactDir,
          expectedPayloadHash: 'different-payload-sha',
        }),
      /payload hash mismatch/
    );
  });

  test('rejects cached assets with incomplete release metadata', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    mkdirSync(join(artifactDir, 'build', 'firefox-release'), { recursive: true });
    writeFileSync(join(artifactDir, 'payload-hash.txt'), 'payload-sha\n');
    writeFileSync(join(artifactDir, 'build', 'firefox-release', 'metadata.json'), '{}\n');
    writeFileSync(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi'),
      'signed-xpi'
    );

    assert.throws(
      () => validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      /metadata must include extensionId and version/
    );
  });

  test('resolves from the fallback repository when the primary repository misses', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');
    const outputDir = createTempDir('cp-firefox-assets-output-');
    const lookups: string[] = [];
    const downloads: string[] = [];

    writeValidFirefoxReleaseCache(artifactDir, 'payload-sha');

    const result = resolveFirefoxReleaseAssetCache({
      repo: 'balejosg/ClassroomPath',
      fallbackRepo: 'balejosg/OpenPath',
      artifactName: 'openpath-firefox-release-assets-payload-sha',
      payloadHash: 'payload-sha',
      outputDir,
      findArtifact: ({ repo }: { repo: string }) => {
        lookups.push(repo);
        return repo === 'balejosg/OpenPath' ? { id: 123 } : null;
      },
      downloadArtifact: ({ repo }: { repo: string }) => {
        downloads.push(repo);
        return { artifactDir };
      },
      cleanupArtifact: () => {},
      copyContents: ({ artifactDir, outputDir }: { artifactDir: string; outputDir: string }) => {
        cpSync(artifactDir, outputDir, { recursive: true, force: true });
      },
    });

    assert.deepEqual(lookups, ['balejosg/ClassroomPath', 'balejosg/OpenPath']);
    assert.deepEqual(downloads, ['balejosg/OpenPath']);
    assert.deepEqual(result, {
      resolved: true,
      artifactId: 123,
      artifactName: 'openpath-firefox-release-assets-payload-sha',
      sourceRepo: 'balejosg/OpenPath',
      cacheMissReason: '',
      extensionId: 'monitor-bloqueos@openpath',
      version: '2.0.0.123',
      signatureSource: 'amo',
      signatureState: 'signed',
    });
  });

  test('reports a cache miss reason when neither repository has the payload artifact', () => {
    const outputDir = createTempDir('cp-firefox-assets-output-');

    const result = resolveFirefoxReleaseAssetCache({
      repo: 'balejosg/ClassroomPath',
      fallbackRepo: 'balejosg/OpenPath',
      artifactName: 'openpath-firefox-release-assets-payload-sha',
      payloadHash: 'payload-sha',
      outputDir,
      findArtifact: () => null,
    });

    assert.deepEqual(result, {
      resolved: false,
      artifactName: 'openpath-firefox-release-assets-payload-sha',
      cacheMissReason: 'artifact_not_found_in_balejosg/ClassroomPath,balejosg/OpenPath',
    });
  });
});
