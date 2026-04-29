import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  VERIFY_DOMAIN_POLICIES,
  flattenVerifyDomainPolicies,
} from '../scripts/lib/verify-domain-policy.ts';
import {
  createVerifyPlan,
  detectVerificationScope,
  RELEASE_AUTOMATION_FILE_PATTERNS,
  summarizeVerifyDomains,
  resolveVerifyDomains,
  VERIFY_FILE_DOMAINS,
} from '../scripts/lib/verify-plan.ts';

describe('verify plan', () => {
  test('detects the release-automation scope for workflow and release-script diffs', () => {
    const stagedFiles = [
      '.github/workflows/firefox-release-assets.yml',
      'scripts/openpath-required-checks.mjs',
      'scripts/resolve-openpath-linux-agent-version.mjs',
      'scripts/lib/github-actions.mjs',
      'tests/workflow-core.test.ts',
      'tests/fixtures/release/manifest.release-candidate.env',
    ];

    assert.equal(detectVerificationScope(stagedFiles, 'commit'), 'release-automation');
  });

  test('detects release automation scope for production canary and evidence helpers', () => {
    for (const stagedFile of [
      '.github/workflows/windows-production-bootstrap-canary.yml',
      '.github/workflows/linux-production-bootstrap-canary.yml',
      'scripts/create-production-windows-bootstrap-canary.mjs',
      'scripts/create-production-linux-bootstrap-canary.mjs',
      'scripts/windows-ajax-auto-allow-canary.mjs',
      'scripts/linux-ajax-auto-allow-canary.mjs',
      'scripts/summarize-linux-ajax-auto-allow-evidence.mjs',
      'scripts/lib/auto-allow-boundary-evidence.mjs',
      'scripts/lib/release-evidence.mjs',
      'scripts/lib/linux-auto-allow-canary-evidence.mjs',
      'scripts/lib/windows-auto-allow-canary-evidence.mjs',
      'tests/release-evidence.test.ts',
      'tests/linux-auto-allow-canary.test.ts',
      'tests/workflow-production-client-canary.test.ts',
    ]) {
      assert.equal(detectVerificationScope([stagedFile], 'commit'), 'release-automation');
    }
  });

  test('keeps full verification for product code changes', () => {
    assert.equal(detectVerificationScope(['react-spa/src/App.tsx'], 'commit'), 'full');
  });

  test('detects the ops-regression scope for deploy/runtime automation diffs', () => {
    assert.equal(
      detectVerificationScope(
        ['scripts/deploy-production-remote.sh', 'docker/docker-compose.yml'],
        'commit'
      ),
      'ops-regression'
    );
  });

  test('detects the ops-regression scope for remote deploy scaffold changes', () => {
    assert.equal(
      detectVerificationScope(['scripts/lib/remote-deploy-scaffold.sh'], 'commit'),
      'ops-regression'
    );
  });

  test('detects the ops-regression scope for maintained documentation diffs', () => {
    assert.equal(
      detectVerificationScope(
        ['AGENTS.md', 'docs/runbooks/deploy-staging.md', 'docs/evaluation/security-trust.md'],
        'commit'
      ),
      'ops-regression'
    );
  });

  test('forces full verification for release mode even on workflow-only changes', () => {
    assert.equal(
      detectVerificationScope(['.github/workflows/firefox-release-assets.yml'], 'release'),
      'full'
    );
  });

  test('chooses e2e depth from verification mode', () => {
    assert.equal(
      createVerifyPlan({
        browsersAvailable: true,
        composeFile: 'docker/docker-compose.test.yml',
        composeProjectName: 'classroompath_test_fixture',
        mode: 'fast',
        playwrightCacheDir: '/tmp/playwright',
        playwrightWorkers: 4,
        rootDir: '/tmp/classroompath',
        stagedFiles: ['react-spa/src/ClassroomPathShell.tsx'],
        testDbPort: 54321,
        workspaceFingerprint: 'fixture-fingerprint',
      }).e2eDepth,
      'skip'
    );

    assert.equal(
      createVerifyPlan({
        browsersAvailable: true,
        composeFile: 'docker/docker-compose.test.yml',
        composeProjectName: 'classroompath_test_fixture',
        mode: 'commit',
        playwrightCacheDir: '/tmp/playwright',
        playwrightWorkers: 4,
        rootDir: '/tmp/classroompath',
        stagedFiles: ['react-spa/src/ClassroomPathShell.tsx'],
        testDbPort: 54321,
        workspaceFingerprint: 'fixture-fingerprint',
      }).e2eDepth,
      'commit-smoke'
    );

    assert.equal(
      createVerifyPlan({
        browsersAvailable: true,
        composeFile: 'docker/docker-compose.test.yml',
        composeProjectName: 'classroompath_test_fixture',
        mode: 'release',
        playwrightCacheDir: '/tmp/playwright',
        playwrightWorkers: 4,
        rootDir: '/tmp/classroompath',
        stagedFiles: ['react-spa/src/ClassroomPathShell.tsx'],
        testDbPort: 54321,
        workspaceFingerprint: 'fixture-fingerprint',
      }).e2eDepth,
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
      workspaceFingerprint: 'fixture-fingerprint',
    });

    assert.equal(plan.verificationScope, 'release-automation');
    assert.equal(plan.needsCoverageGate, false);
    assert.deepEqual(plan.domainSummary.owners, ['release-engineering']);
    assert.deepEqual(
      RELEASE_AUTOMATION_FILE_PATTERNS.some((pattern) => pattern.test('scripts/verify-full.ts')),
      true
    );
  });

  test('models release automation as a domain policy instead of a flat allowlist', () => {
    const domains = resolveVerifyDomains('scripts/lib/release-candidate.mjs');
    const flattenedPolicies = flattenVerifyDomainPolicies();

    assert.ok(
      VERIFY_DOMAIN_POLICIES.some(
        (domain) => domain.owner === 'release-engineering' && domain.name === 'release-library'
      ),
      'verify-domain-policy.ts should declare release-safe ownership in dedicated metadata'
    );
    assert.ok(
      flattenedPolicies.some(
        (domain) => domain.owner === 'release-engineering' && domain.name === 'release-library'
      ),
      'verify-domain-policy.ts should flatten domain metadata into file matchers'
    );
    assert.ok(
      VERIFY_FILE_DOMAINS.some(
        (domain) => 'owner' in domain && domain.owner === 'release-engineering'
      ),
      'verify-plan.ts should consume ownership-aware domain metadata instead of raw regex constants'
    );
    assert.deepEqual(
      domains.map((domain) => domain.name),
      ['release-library']
    );
  });

  test('summarizes owners and approvals from the matched domains', () => {
    assert.deepEqual(
      summarizeVerifyDomains([
        'scripts/release-images.mjs',
        '.github/workflows/ci.yml',
        'react-spa/src/App.tsx',
      ]),
      {
        matchedDomains: ['release-cli', 'workflow-definition', 'spa-source'],
        owners: ['release-engineering', 'application'],
        releaseGates: ['staging-release-gate', 'production-release-gate'],
        requiredApprovals: ['release-engineering', 'application'],
        reviewers: ['release-engineering', 'application'],
      }
    );
  });
});
