import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { validateFirefoxReleaseAssetCache } from '../scripts/resolve-firefox-release-assets-cache.mjs';

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
    `${JSON.stringify({ extensionId: 'monitor-bloqueos@openpath', version: '2.0.0.123' })}\n`
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
      }
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
});
