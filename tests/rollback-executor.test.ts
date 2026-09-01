import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROLLBACK_EXECUTOR_FAULT_POINTS,
  buildRollbackPlan,
  runRollbackScenario,
} from '../scripts/lib/rollback-executor.mjs';

const previousReleaseId = 'a'.repeat(64);
const candidateReleaseId = 'b'.repeat(64);

test('rollback plan consumes only the durable previous release bundle', () => {
  const plan = buildRollbackPlan({
    currentReleaseId: candidateReleaseId,
    previousReleaseId,
    previousBundle: {
      releaseId: previousReleaseId,
      bundleSha256: previousReleaseId,
      contractSha256: 'c'.repeat(64),
      imageRefs: ['ghcr.io/example/api@sha256:' + 'd'.repeat(64)],
    },
    candidateRuntime: { helper: 'broken', openPathMetadata: 'changed' },
    remoteMetadata: { latest: candidateReleaseId, openPath: 'changed' },
  });

  assert.equal(plan.releaseId, previousReleaseId);
  assert.equal(plan.source, 'stored-previous-release');
  assert.deepEqual(plan.steps, [
    'verify-previous-bundle',
    'verify-previous-contract',
    'verify-immutable-images',
    'materialize-previous-runtime',
    'construct-rollback-plan',
  ]);
  assert.equal(plan.usesCandidateRuntime, false);
  assert.equal(plan.usesRemoteReleaseSelection, false);
});

test('rollback remains executable when candidate helpers and host Node are unavailable', () => {
  const result = runRollbackScenario({
    currentReleaseId: candidateReleaseId,
    previousReleaseId,
    candidateBroken: true,
    hostNodeAvailable: false,
  });

  assert.equal(result.phase, 'ROLLED_BACK');
  assert.equal(result.activeReleaseId, previousReleaseId);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackResult, 'success');
  assert.equal(result.usedCandidateHelper, false);
  assert.equal(result.usedHostNode, false);
});

test('rollback never activates the previous ID when health/readiness fails', () => {
  const result = runRollbackScenario({
    currentReleaseId: candidateReleaseId,
    previousReleaseId,
    failurePoint: 'rollback-readiness',
  });

  assert.equal(result.phase, 'FAILED');
  assert.equal(result.activeReleaseId, candidateReleaseId);
  assert.equal(result.rollbackResult, 'failed');
  assert.equal(result.failureCategory, 'rollback-execution');
});

test('rollback fault injection fails closed at every recovery boundary', () => {
  assert.deepEqual(ROLLBACK_EXECUTOR_FAULT_POINTS, [
    'rollback-preflight',
    'rollback-execution',
    'rollback-readiness',
    'rollback-activation',
  ]);

  for (const failurePoint of ROLLBACK_EXECUTOR_FAULT_POINTS) {
    const result = runRollbackScenario({
      currentReleaseId: candidateReleaseId,
      previousReleaseId,
      failurePoint,
    });

    assert.equal(result.phase, 'FAILED', failurePoint);
    assert.equal(result.activeReleaseId, candidateReleaseId, failurePoint);
    assert.equal(result.usedCandidateHelper, false, failurePoint);
    assert.equal(result.usedHostNode, false, failurePoint);
    assert.equal(result.rollbackAttempted, failurePoint !== 'rollback-preflight', failurePoint);
  }
});

test('rollback rejects incomplete or mutable stored recovery material', () => {
  const baseBundle = {
    releaseId: previousReleaseId,
    bundleSha256: previousReleaseId,
    contractSha256: 'c'.repeat(64),
    imageRefs: ['ghcr.io/example/api@sha256:' + 'd'.repeat(64)],
  };
  const baseInput = {
    currentReleaseId: candidateReleaseId,
    previousReleaseId,
    previousBundle: baseBundle,
  };

  assert.throws(
    () => buildRollbackPlan({ ...baseInput, previousBundle: undefined }),
    /stored previous release bundle/u
  );
  assert.throws(
    () =>
      buildRollbackPlan({
        ...baseInput,
        previousBundle: { ...baseBundle, contractSha256: 'invalid' },
      }),
    /contractSha256/u
  );
  assert.throws(
    () =>
      buildRollbackPlan({
        ...baseInput,
        previousBundle: { ...baseBundle, imageRefs: [] },
      }),
    /no runtime image references/u
  );
  assert.throws(
    () =>
      buildRollbackPlan({
        ...baseInput,
        previousBundle: { ...baseBundle, imageRefs: ['ghcr.io/example/api:latest'] },
      }),
    /immutable OCI digests/u
  );
});
