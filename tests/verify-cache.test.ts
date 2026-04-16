import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import { createVerifyCache } from '../scripts/lib/verify-cache.ts';

const FIXTURE_PLAN = {
  browsersAvailable: true,
  composeFile: 'docker/docker-compose.test.yml',
  composeProjectName: 'classroompath_test_fixture',
  domainSummary: {
    matchedDomains: ['verify-library'],
    owners: ['release-engineering'],
    releaseGates: ['staging-release-gate', 'production-release-gate'],
    requiredApprovals: ['release-engineering'],
    reviewers: ['release-engineering'],
  },
  mode: 'commit',
  e2eDepth: 'commit-smoke',
  needsApiCoverage: false,
  needsCoverageGate: false,
  needsSpaCoverage: false,
  playwrightCacheDir: '/tmp/playwright',
  playwrightWorkers: 4,
  rootDir: '/tmp/classroompath',
  skipOpenPathStatic: false,
  stagedFiles: ['scripts/lib/verify-cache.ts'],
  submoduleOnly: false,
  testDbPort: 54321,
  verificationScope: 'release-automation',
  workspaceFingerprint: 'fixture-fingerprint',
};

describe('verify cache', () => {
  test('requires declared artifacts to exist before reusing a cached stage', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'classroompath-verify-cache-test-'));
    const artifactPath = join(cacheDir, 'artifact.txt');
    const cacheFile = join(cacheDir, 'verify-cache.json');

    try {
      const cache = createVerifyCache(FIXTURE_PLAN, { cacheFile });
      const cacheKey = cache.buildStageCacheKey('build', { command: 'npm run build' });

      cache.rememberPassedStage('build', cacheKey, [{ kind: 'build-output', path: artifactPath }]);
      assert.equal(await cache.shouldReuse('build', { key: cacheKey }), false);

      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(artifactPath, 'ok\n', 'utf8');
      assert.equal(await cache.shouldReuse('build', { key: cacheKey }), true);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test('stage cache keys include lockfiles and verification inputs', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'classroompath-verify-cache-key-test-'));

    try {
      mkdirSync(join(rootDir, 'upstream/openpath'), { recursive: true });
      mkdirSync(join(rootDir, 'scripts/lib'), { recursive: true });
      mkdirSync(join(rootDir, 'docker'), { recursive: true });
      writeFileSync(join(rootDir, 'package-lock.json'), '{"root":1}\n', 'utf8');
      writeFileSync(
        join(rootDir, 'upstream/openpath/package-lock.json'),
        '{"upstream":1}\n',
        'utf8'
      );
      writeFileSync(join(rootDir, 'scripts/verify-full.ts'), 'verify-v1\n', 'utf8');
      writeFileSync(
        join(rootDir, 'scripts/lib/verification-stage-runners.ts'),
        'runner-v1\n',
        'utf8'
      );
      writeFileSync(join(rootDir, 'docker/Dockerfile.cp-api'), 'docker-v1\n', 'utf8');

      const plan = { ...FIXTURE_PLAN, rootDir };
      const firstKey = createVerifyCache(plan).buildStageCacheKey('build', {
        command: 'npm run build',
      });

      writeFileSync(join(rootDir, 'package-lock.json'), '{"root":2}\n', 'utf8');
      const secondKey = createVerifyCache(plan).buildStageCacheKey('build', {
        command: 'npm run build',
      });

      assert.notEqual(firstKey, secondKey);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
