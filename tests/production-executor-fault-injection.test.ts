import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SWITCH_FAULT_POINTS,
  PRODUCTION_EXECUTOR_FAULT_POINTS,
  runProductionExecutorScenario,
} from '../scripts/lib/production-executor-scenario.mjs';

const previousReleaseId = 'a'.repeat(64);
const candidateReleaseId = 'b'.repeat(64);

test('fault injection covers every forward executor failure point', () => {
  assert.deepEqual(PRODUCTION_EXECUTOR_FAULT_POINTS, [
    'verifier-unavailable',
    'verifier-command-missing',
    'runtime-projection',
    'docker-pull',
    'migration',
    'container-stop',
    'container-create',
    'container-start',
    'health',
    'malformed-ready',
    'ready-false',
    'state-persistence',
    'candidate-pointer-update',
    'commit-current-activation',
  ]);

  for (const failurePoint of PRODUCTION_EXECUTOR_FAULT_POINTS) {
    const result = runProductionExecutorScenario({
      previousReleaseId,
      candidateReleaseId,
      failurePoint,
    });

    assert.notEqual(result.phase, 'COMMITTED', failurePoint);
    assert.equal(result.failurePoint, failurePoint);
    assert.ok(result.failureCategory, failurePoint);
    assert.equal(result.diagnostic.failurePoint, failurePoint);
    assert.equal(result.diagnostic.requestedReleaseId, candidateReleaseId);
    assert.equal(result.diagnostic.previousReleaseId, previousReleaseId);
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /secret|token|cookie|authorization/iu);

    if (POST_SWITCH_FAULT_POINTS.includes(failurePoint)) {
      assert.equal(result.mutationBoundaryReached, true, failurePoint);
      assert.equal(result.rollbackAttempted, true, failurePoint);
      assert.ok(['ROLLED_BACK', 'FAILED'].includes(result.phase), failurePoint);
    } else {
      assert.equal(result.mutationBoundaryReached, false, failurePoint);
      assert.equal(result.rollbackAttempted, false, failurePoint);
      assert.equal(result.currentReleaseId, previousReleaseId, failurePoint);
    }
  }
});

test('successful executor commits only after semantic readiness', () => {
  const result = runProductionExecutorScenario({
    previousReleaseId,
    candidateReleaseId,
  });

  assert.equal(result.phase, 'COMMITTED');
  assert.equal(result.currentReleaseId, candidateReleaseId);
  assert.equal(result.previousReleaseId, previousReleaseId);
  assert.equal(result.mutationBoundaryReached, true);
  assert.equal(result.rollbackAttempted, false);
  assert.deepEqual(
    result.events.map((event) => event.stage),
    ['RESOLVE', 'PREFLIGHT', 'PREPARE', 'SWITCH', 'VERIFY', 'COMMIT']
  );
});
