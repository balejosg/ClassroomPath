import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import {
  deriveFirefoxReleaseVersion,
  deriveFirefoxReleaseVersionFromManifest,
  normalizeRunIdSuffix,
  validateFirefoxReleaseVersion,
} from '../scripts/lib/firefox-release-version.mjs';

describe('firefox release version helper', () => {
  it('normalizes the trailing run-id suffix through decimal parsing', () => {
    assert.equal(normalizeRunIdSuffix('24110161260'), '161260');
    assert.equal(normalizeRunIdSuffix('24110515254'), '515254');
  });

  it('derives an AMO-safe version without leading-zero numeric segments', () => {
    const version = deriveFirefoxReleaseVersion({
      baseVersion: '1.0.0',
      runId: '24110161260',
      runAttempt: '1',
    });

    assert.equal(version, '1.0.0.16126001');
  });

  it('rejects versions with leading-zero numeric segments', () => {
    assert.throws(() => validateFirefoxReleaseVersion('1.0.0.016126001'), /leading zero/);
  });

  it('reads the base version from a manifest file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cp-firefox-release-version-'));
    const manifestPath = join(tempDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ version: '2.5.9' }), 'utf8');

    const version = deriveFirefoxReleaseVersionFromManifest({
      manifestPath,
      runId: '24110515254',
      runAttempt: '3',
    });

    assert.equal(version, '2.5.9.51525403');
  });
});
