/**
 * Pure rollback contract and fixture runner. The production implementation is
 * rollback-executor.sh; this module makes exact-source and failure semantics
 * executable without a host, Docker daemon, SSH connection, or registry.
 */

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const ROLLBACK_EXECUTOR_FAULT_POINTS = Object.freeze([
  'rollback-preflight',
  'rollback-execution',
  'rollback-readiness',
  'rollback-activation',
]);

function assertReleaseId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

function assertDigestReference(value) {
  if (!/^.+@sha256:[0-9a-f]{64}$/.test(String(value ?? ''))) {
    throw new Error('rollback image references must be immutable OCI digests');
  }
}

/**
 * @param {Record<string, any>} [options]
 */
export function buildRollbackPlan({
  currentReleaseId,
  previousReleaseId,
  previousBundle,
  candidateRuntime,
  remoteMetadata,
} = {}) {
  const current = assertReleaseId(currentReleaseId, 'currentReleaseId');
  const previous = assertReleaseId(previousReleaseId, 'previousReleaseId');
  if (!previousBundle || previousBundle.releaseId !== previous) {
    throw new Error('stored previous release bundle does not match previousReleaseId');
  }
  if (previousBundle.bundleSha256 !== previous) {
    throw new Error('stored previous release bundle hash does not match previousReleaseId');
  }
  assertReleaseId(previousBundle.contractSha256, 'previous contractSha256');
  if (!Array.isArray(previousBundle.imageRefs) || previousBundle.imageRefs.length === 0) {
    throw new Error('stored previous release bundle has no runtime image references');
  }
  for (const imageRef of previousBundle.imageRefs ?? []) assertDigestReference(imageRef);

  // These arguments are intentionally accepted only to make the test fixture
  // explicit: selection never reads candidate or current remote metadata.
  void candidateRuntime;
  void remoteMetadata;

  return {
    releaseId: previous,
    currentReleaseId: current,
    source: 'stored-previous-release',
    steps: [
      'verify-previous-bundle',
      'verify-previous-contract',
      'verify-immutable-images',
      'materialize-previous-runtime',
      'construct-rollback-plan',
    ],
    usesCandidateRuntime: false,
    usesRemoteReleaseSelection: false,
  };
}

/**
 * @param {Record<string, any>} [options]
 */
export function runRollbackScenario({
  currentReleaseId,
  previousReleaseId,
  candidateBroken = false,
  hostNodeAvailable = true,
  failurePoint = '',
} = {}) {
  const current = assertReleaseId(currentReleaseId, 'currentReleaseId');
  const previous = assertReleaseId(previousReleaseId, 'previousReleaseId');
  const plan = buildRollbackPlan({
    currentReleaseId: current,
    previousReleaseId: previous,
    previousBundle: {
      releaseId: previous,
      bundleSha256: previous,
      contractSha256: 'c'.repeat(64),
      imageRefs: ['ghcr.io/example/api@sha256:' + 'd'.repeat(64)],
    },
  });

  if (failurePoint === 'rollback-preflight') {
    return {
      phase: 'FAILED',
      activeReleaseId: current,
      rollbackAttempted: false,
      rollbackResult: 'not_attempted',
      failureCategory: 'rollback-preflight',
      usedCandidateHelper: false,
      usedHostNode: false,
      plan,
    };
  }

  if (['rollback-readiness', 'rollback-execution', 'rollback-activation'].includes(failurePoint)) {
    return {
      phase: 'FAILED',
      activeReleaseId: current,
      rollbackAttempted: true,
      rollbackResult: 'failed',
      failureCategory: 'rollback-execution',
      usedCandidateHelper: false,
      usedHostNode: false,
      plan,
    };
  }

  return {
    phase: 'ROLLED_BACK',
    activeReleaseId: plan.releaseId,
    rollbackAttempted: true,
    rollbackResult: 'success',
    failureCategory: '',
    usedCandidateHelper: false,
    usedHostNode: false,
    candidateBroken,
    hostNodeAvailable,
    plan,
  };
}
