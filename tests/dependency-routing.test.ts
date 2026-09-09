import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectCiRelevantChanges } from '../scripts/detect-ci-relevant-changes.mjs';
import { resolveRegressionPlan } from '../scripts/lib/regression-plan.mjs';
import { summarizeVerificationDomains } from '../scripts/lib/verification-catalog.mjs';
import { detectVerificationScope } from '../scripts/lib/verify-plan.ts';

const ALL_SCOPES = {
  ci_relevant: 'true',
  product_validation: 'true',
  ops_regression: 'true',
  release_automation: 'true',
};

const PRODUCT_SCOPE = {
  ci_relevant: 'true',
  product_validation: 'true',
  ops_regression: 'false',
  release_automation: 'false',
};

function scopesFor(changedFiles: string[]) {
  const result = detectCiRelevantChanges(changedFiles);
  return {
    ci_relevant: result.ci_relevant,
    product_validation: result.product_validation,
    ops_regression: result.ops_regression,
    release_automation: result.release_automation,
  };
}

describe('dependency-aware CI routing', () => {
  test('A: the 9bb69c31 lock-only dependency update fails closed to every lane', () => {
    assert.deepEqual(scopesFor(['package-lock.json']), ALL_SCOPES);
  });

  test('B/G/H/I/J: maintained ClassroomPath workspace manifests select product validation', () => {
    for (const manifest of [
      'api/package.json',
      'react-spa/package.json',
      'contracts/package.json',
      'presenters/package.json',
      'trpc-contract/package.json',
      'testkit/package.json',
    ]) {
      assert.deepEqual(scopesFor([manifest]), PRODUCT_SCOPE, manifest);
    }
  });

  test('C/D/L: arbitrary root dependency changes use the full fail-closed union', () => {
    for (const manifest of ['package.json', 'package-lock.json']) {
      assert.deepEqual(scopesFor([manifest]), ALL_SCOPES, manifest);
    }
  });

  test('E/P: an unknown future ClassroomPath workspace manifest cannot silently skip CI', () => {
    assert.deepEqual(scopesFor(['packages/future-workspace/package.json']), PRODUCT_SCOPE);
  });

  test('F/M/N/O: mixed root dependency changes preserve the union without degradation', () => {
    for (const changedFiles of [
      ['package-lock.json', 'react-spa/src/ClassroomPathShell.tsx'],
      ['package-lock.json', 'scripts/deploy-production-remote.sh'],
      ['package-lock.json', 'scripts/release-status.mjs'],
    ]) {
      assert.deepEqual(scopesFor(changedFiles), ALL_SCOPES, changedFiles.join(','));
    }
  });

  test('K: .gitmodules preserves its pre-existing release-only routing', () => {
    assert.deepEqual(scopesFor(['.gitmodules']), {
      ci_relevant: 'true',
      product_validation: 'false',
      ops_regression: 'false',
      release_automation: 'true',
    });
  });

  test('normal product, ops, and release files retain their isolated lanes', () => {
    assert.deepEqual(scopesFor(['api/src/server.ts']), PRODUCT_SCOPE);
    assert.deepEqual(scopesFor(['scripts/deploy-production-remote.sh']), {
      ci_relevant: 'true',
      product_validation: 'false',
      ops_regression: 'true',
      release_automation: 'false',
    });
    assert.deepEqual(scopesFor(['scripts/release-status.mjs']), {
      ci_relevant: 'true',
      product_validation: 'false',
      ops_regression: 'false',
      release_automation: 'true',
    });
  });

  test('root dependency routing is represented by one canonical domain', () => {
    assert.deepEqual(summarizeVerificationDomains(['package-lock.json']).matchedDomains, [
      'root-dependency-contract',
    ]);
    assert.deepEqual(summarizeVerificationDomains(['.gitmodules']).matchedDomains, [
      'root-package-contract',
    ]);
  });

  test('dependency routing preserves canonical ownership and release gates', () => {
    const rootDependency = detectCiRelevantChanges(['package-lock.json']);
    assert.equal(rootDependency.domain_owners, 'release-engineering');
    assert.equal(rootDependency.release_gates, 'staging-release-gate,production-release-gate');

    const workspaceManifest = detectCiRelevantChanges(['api/package.json']);
    assert.equal(workspaceManifest.domain_owners, 'application');
    assert.equal(workspaceManifest.release_gates, 'staging-release-gate');

    const mixed = detectCiRelevantChanges(['package-lock.json', 'api/package.json']);
    assert.equal(mixed.domain_owners, 'release-engineering,application');
    assert.equal(mixed.release_gates, 'staging-release-gate,production-release-gate');
  });

  test('the composed dependency scope selects the canonical full local pipeline', () => {
    assert.equal(detectVerificationScope(['package-lock.json'], 'commit'), 'full');
    assert.equal(detectVerificationScope(['package.json'], 'fast'), 'full');
  });

  test('routing regressions execute exactly once in each canonical regression command', () => {
    for (const plan of ['workflow-config', 'release-automation']) {
      assert.equal(
        resolveRegressionPlan(plan).filter((file) => file === 'tests/dependency-routing.test.ts')
          .length,
        1,
        plan
      );
    }
  });
});
