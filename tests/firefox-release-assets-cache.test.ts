import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  resolveFirefoxReleaseAssetCache,
  validateFirefoxReleaseAssetCache,
} from '../scripts/resolve-firefox-release-assets-cache.mjs';
import {
  classifyFirefoxReleaseAssetEvidence,
  formatFirefoxReleaseAssetEvidenceSummary,
} from '../scripts/firefox-release-evidence.mjs';

const tempDirectories: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(dir);
  return dir;
}

function writeSignedXpiFixture(xpiPath: string): void {
  const fixtureDir = createTempDir('cp-firefox-signed-xpi-');
  mkdirSync(join(fixtureDir, 'META-INF'), { recursive: true });
  writeFileSync(join(fixtureDir, 'manifest.json'), '{"manifest_version":3}\n');
  writeFileSync(join(fixtureDir, 'META-INF', 'manifest.mf'), 'Manifest-Version: 1.0\n');
  writeFileSync(join(fixtureDir, 'META-INF', 'mozilla.rsa'), 'fake-signature\n');
  execFileSync('zip', ['-qr', xpiPath, '.'], { cwd: fixtureDir });
}

function writeUnsignedXpiFixture(xpiPath: string): void {
  const fixtureDir = createTempDir('cp-firefox-unsigned-xpi-');
  writeFileSync(join(fixtureDir, 'manifest.json'), '{"manifest_version":3}\n');
  execFileSync('zip', ['-qr', xpiPath, '.'], { cwd: fixtureDir });
}

function writeManifestOnlyXpiFixture(xpiPath: string): void {
  const fixtureDir = createTempDir('cp-firefox-manifest-only-xpi-');
  mkdirSync(join(fixtureDir, 'META-INF'), { recursive: true });
  writeFileSync(join(fixtureDir, 'manifest.json'), '{"manifest_version":3}\n');
  writeFileSync(join(fixtureDir, 'META-INF', 'manifest.mf'), 'Manifest-Version: 1.0\n');
  execFileSync('zip', ['-qr', xpiPath, '.'], { cwd: fixtureDir });
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
  writeSignedXpiFixture(
    join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi')
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
    writeSignedXpiFixture(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi')
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
    writeSignedXpiFixture(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi')
    );

    assert.throws(
      () => validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      /metadata must include extensionId and version/
    );
  });

  test('rejects cached assets whose XPI is labelled signed but has no AMO signature files', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    mkdirSync(join(artifactDir, 'build', 'firefox-release'), { recursive: true });
    writeFileSync(join(artifactDir, 'payload-hash.txt'), 'payload-sha\n');
    writeFileSync(
      join(artifactDir, 'build', 'firefox-release', 'metadata.json'),
      `${JSON.stringify({
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.123',
        signatureSource: 'amo',
        signatureState: 'signed',
      })}\n`
    );
    writeUnsignedXpiFixture(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi')
    );

    assert.throws(
      () => validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      /Firefox release asset XPI must include AMO signature files under META-INF/
    );
  });

  test('rejects cached assets whose XPI has META-INF without Mozilla signature files', () => {
    const artifactDir = createTempDir('cp-firefox-assets-cache-');

    mkdirSync(join(artifactDir, 'build', 'firefox-release'), { recursive: true });
    writeFileSync(join(artifactDir, 'payload-hash.txt'), 'payload-sha\n');
    writeFileSync(
      join(artifactDir, 'build', 'firefox-release', 'metadata.json'),
      `${JSON.stringify({
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.123',
        signatureSource: 'amo',
        signatureState: 'signed',
      })}\n`
    );
    writeManifestOnlyXpiFixture(
      join(artifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi')
    );

    assert.throws(
      () => validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash: 'payload-sha' }),
      /Firefox release asset XPI must include AMO signature files under META-INF/
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
      releaseState: 'cache-hit',
      artifactSource: 'cache',
      amoFileStatus: '',
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

describe('Firefox release asset evidence classification', () => {
  test('classifies a valid cache hit as actionable cache reuse evidence', () => {
    assert.deepEqual(
      classifyFirefoxReleaseAssetEvidence({
        cacheResolved: true,
        cacheSourceRepo: 'balejosg/OpenPath',
        cacheMissReason: '',
        signExitCode: '',
        signOutput: '',
        signedArtifactsPresent: true,
      }),
      {
        releaseState: 'cache-hit',
        artifactSource: 'cache',
        amoFileStatus: '',
        signedArtifactsPresent: true,
        amoSigningRequired: false,
        cacheSourceRepo: 'balejosg/OpenPath',
        cacheMissReason: '',
      }
    );
  });

  test('classifies fresh signing separately from cache reuse', () => {
    assert.deepEqual(
      classifyFirefoxReleaseAssetEvidence({
        cacheResolved: false,
        cacheSourceRepo: '',
        cacheMissReason: 'artifact_not_found',
        signExitCode: '0',
        signOutput:
          '[sign:firefox-release] AMO version status addonId=openpath versionId=6249209 fileStatus=unreviewed',
        signedArtifactsPresent: true,
      }),
      {
        releaseState: 'fresh-signing',
        artifactSource: 'signed',
        amoFileStatus: 'unreviewed',
        signedArtifactsPresent: true,
        amoSigningRequired: true,
        cacheSourceRepo: '',
        cacheMissReason: 'artifact_not_found',
      }
    );
  });

  test('makes AMO manual review diagnosable without treating it as success', () => {
    const evidence = classifyFirefoxReleaseAssetEvidence({
      cacheResolved: false,
      cacheSourceRepo: '',
      cacheMissReason: 'artifact_not_found',
      signExitCode: '1',
      signOutput:
        '[sign:firefox-release] AMO version status addonId=openpath versionId=6249209 fileStatus=unreviewed\nApproval: timeout exceeded. When approved the signed XPI file can be downloaded from https://addons.mozilla.org/en-US/developers/addon/openpath/versions/6249209',
      signedArtifactsPresent: false,
    });

    assert.equal(evidence.releaseState, 'manual-review-required');
    assert.equal(evidence.artifactSource, 'manual-review-required');
    assert.equal(evidence.amoFileStatus, 'unreviewed');
    assert.equal(evidence.signedArtifactsPresent, false);
    assert.match(formatFirefoxReleaseAssetEvidenceSummary(evidence), /manual-review-required/);
  });

  test('classifies signing timeouts separately from hard failures', () => {
    assert.equal(
      classifyFirefoxReleaseAssetEvidence({
        cacheResolved: false,
        cacheSourceRepo: '',
        cacheMissReason: 'artifact_not_found',
        signExitCode: '124',
        signOutput:
          '[sign:firefox-release] AMO signing exhausted the total timeout before web-ext sign could finish',
        signedArtifactsPresent: false,
      }).releaseState,
      'timeout'
    );

    assert.equal(
      classifyFirefoxReleaseAssetEvidence({
        cacheResolved: false,
        cacheSourceRepo: '',
        cacheMissReason: 'artifact_not_found',
        signExitCode: '1',
        signOutput: 'web-ext sign failed with status 1',
        signedArtifactsPresent: false,
      }).releaseState,
      'hard-failure'
    );
  });
});
