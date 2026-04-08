import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createVerifyPlan,
  detectVerificationScope,
  RELEASE_AUTOMATION_FILE_PATTERNS,
} from '../scripts/lib/verify-plan.ts';

describe('verify plan', () => {
  test('detects the release-automation scope for workflow and release-script diffs', () => {
    const stagedFiles = [
      '.github/workflows/firefox-release-assets.yml',
      'scripts/openpath-required-checks.mjs',
      'scripts/lib/github-actions.mjs',
      'tests/workflow-config.test.ts',
      'tests/fixtures/release/manifest.release-candidate.env',
    ];

    assert.equal(detectVerificationScope(stagedFiles, 'commit'), 'release-automation');
  });

  test('keeps full verification for product code changes', () => {
    assert.equal(detectVerificationScope(['react-spa/src/App.tsx'], 'commit'), 'full');
  });

  test('forces full verification for release mode even on workflow-only changes', () => {
    assert.equal(
      detectVerificationScope(['.github/workflows/firefox-release-assets.yml'], 'release'),
      'full'
    );
  });

  test('builds a plan that preserves the release-automation scope and coverage decisions', () => {
    const plan = createVerifyPlan({
      browsersAvailable: true,
      composeFile: 'docker/docker-compose.test.yml',
      composeProjectName: 'classroompath_test_fixture',
      mode: 'commit',
      playwrightCacheDir: '/tmp/playwright',
      playwrightWorkers: 4,
      rootDir: '/tmp/classroompath',
      stagedFiles: ['scripts/firefox-release-version.mjs', 'tests/firefox-release-version.test.ts'],
      testDbPort: 54321,
    });

    assert.equal(plan.verificationScope, 'release-automation');
    assert.equal(plan.needsCoverageGate, false);
    assert.deepEqual(
      RELEASE_AUTOMATION_FILE_PATTERNS.some((pattern) => pattern.test('scripts/verify-full.ts')),
      true
    );
  });
});
