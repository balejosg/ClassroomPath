/**
 * Deterministic, side-effect-free production executor model used by local and
 * CI-equivalent fault-injection tests. The real remote executor mirrors this
 * phase and transition contract in shell.
 */

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const DEPLOYMENT_PHASES = Object.freeze({
  PREPARED: 'PREPARED',
  SWITCHING: 'SWITCHING',
  ACTIVATED_UNVERIFIED: 'ACTIVATED_UNVERIFIED',
  VERIFIED: 'VERIFIED',
  COMMITTED: 'COMMITTED',
  ROLLING_BACK: 'ROLLING_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  FAILED: 'FAILED',
});

export const PRODUCTION_EXECUTOR_FAULT_POINTS = Object.freeze([
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

export const POST_SWITCH_FAULT_POINTS = Object.freeze([
  'migration',
  'container-stop',
  'container-create',
  'container-start',
  'health',
  'malformed-ready',
  'ready-false',
  'candidate-pointer-update',
  'commit-current-activation',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [DEPLOYMENT_PHASES.PREPARED]: [DEPLOYMENT_PHASES.SWITCHING, DEPLOYMENT_PHASES.FAILED],
  [DEPLOYMENT_PHASES.SWITCHING]: [
    DEPLOYMENT_PHASES.ACTIVATED_UNVERIFIED,
    DEPLOYMENT_PHASES.FAILED,
    DEPLOYMENT_PHASES.ROLLING_BACK,
  ],
  [DEPLOYMENT_PHASES.ACTIVATED_UNVERIFIED]: [
    DEPLOYMENT_PHASES.VERIFIED,
    DEPLOYMENT_PHASES.FAILED,
    DEPLOYMENT_PHASES.ROLLING_BACK,
  ],
  [DEPLOYMENT_PHASES.VERIFIED]: [
    DEPLOYMENT_PHASES.COMMITTED,
    DEPLOYMENT_PHASES.FAILED,
    DEPLOYMENT_PHASES.ROLLING_BACK,
  ],
  [DEPLOYMENT_PHASES.FAILED]: [DEPLOYMENT_PHASES.ROLLING_BACK],
  [DEPLOYMENT_PHASES.ROLLING_BACK]: [DEPLOYMENT_PHASES.ROLLED_BACK, DEPLOYMENT_PHASES.FAILED],
  [DEPLOYMENT_PHASES.COMMITTED]: [],
  [DEPLOYMENT_PHASES.ROLLED_BACK]: [],
});

function assertReleaseId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

/**
 * @param {Record<string, any>} [options]
 */
export function createDeploymentTransaction({ previousReleaseId, candidateReleaseId } = {}) {
  return {
    phase: DEPLOYMENT_PHASES.PREPARED,
    previousReleaseId: assertReleaseId(previousReleaseId, 'previousReleaseId'),
    candidateReleaseId: assertReleaseId(candidateReleaseId, 'candidateReleaseId'),
    currentReleaseId: assertReleaseId(previousReleaseId, 'previousReleaseId'),
    mutationBoundaryReached: false,
    committed: false,
  };
}

export function transitionDeploymentState(transaction, nextPhase) {
  const currentPhase = transaction?.phase;
  const allowed = ALLOWED_TRANSITIONS[currentPhase] ?? [];
  if (!allowed.includes(nextPhase)) {
    throw new Error(`invalid deployment transition: ${currentPhase} -> ${nextPhase}`);
  }
  if (nextPhase === DEPLOYMENT_PHASES.ROLLING_BACK && !transaction.mutationBoundaryReached) {
    throw new Error('invalid deployment transition: rollback requires the mutation boundary');
  }

  const next = { ...transaction, phase: nextPhase };
  if (nextPhase === DEPLOYMENT_PHASES.SWITCHING) next.mutationBoundaryReached = true;
  if (nextPhase === DEPLOYMENT_PHASES.COMMITTED) {
    next.currentReleaseId = next.candidateReleaseId;
    next.committed = true;
  }
  if (nextPhase === DEPLOYMENT_PHASES.ROLLED_BACK) {
    next.currentReleaseId = next.previousReleaseId;
    next.committed = false;
  }
  return next;
}

const FAILURE_CATEGORIES = Object.freeze({
  'verifier-unavailable': 'verifier-packaging',
  'verifier-command-missing': 'verifier-packaging',
  'runtime-projection': 'runtime-projection',
  'docker-pull': 'image-pull',
  migration: 'migration',
  'container-stop': 'container-switch',
  'container-create': 'container-switch',
  'container-start': 'container-switch',
  health: 'health',
  'malformed-ready': 'readiness',
  'ready-false': 'readiness',
  'state-persistence': 'state-write',
  'candidate-pointer-update': 'state-write',
  'commit-current-activation': 'state-write',
  'rollback-preflight': 'rollback-preflight',
  'rollback-readiness': 'rollback-execution',
  'rollback-execution': 'rollback-execution',
  'rollback-activation': 'rollback-execution',
});

function failureCategory(failurePoint) {
  return FAILURE_CATEGORIES[failurePoint] ?? 'remote-connectivity';
}

/**
 * @param {Record<string, any>} [options]
 */
export function buildProductionDiagnostic({
  requestedReleaseId,
  currentReleaseId,
  candidateReleaseId,
  previousReleaseId,
  deploymentPhase,
  finalPhase,
  mutationBoundaryReached,
  failurePoint = '',
  failureCategory: category = '',
  rollbackAttempted,
  rollbackResult,
} = {}) {
  return {
    schemaVersion: 1,
    mode: mutationBoundaryReached ? 'failure-diagnostic' : 'pre-switch-failure',
    requestedReleaseId: String(requestedReleaseId ?? ''),
    currentReleaseId: String(currentReleaseId ?? ''),
    candidateReleaseId: String(candidateReleaseId ?? ''),
    previousReleaseId: String(previousReleaseId ?? ''),
    deploymentPhase: String(deploymentPhase ?? ''),
    finalPhase: String(finalPhase ?? ''),
    mutationBoundaryReached: Boolean(mutationBoundaryReached),
    failurePoint: String(failurePoint ?? ''),
    failureCategory: String(category ?? ''),
    containerIdentities: [],
    containerStatus: [],
    health: { status: 'not-run' },
    readiness: { status: 'not-run' },
    rollbackAttempted: Boolean(rollbackAttempted),
    rollbackResult: String(rollbackResult ?? 'not_attempted'),
  };
}

function operationStage(failurePoint) {
  if (['verifier-unavailable', 'verifier-command-missing'].includes(failurePoint)) {
    return 'PREFLIGHT';
  }
  if (['runtime-projection', 'docker-pull', 'state-persistence'].includes(failurePoint)) {
    return 'PREPARE';
  }
  if (POST_SWITCH_FAULT_POINTS.includes(failurePoint)) return 'SWITCH';
  return 'PREPARE';
}

function failureMessage(failurePoint) {
  return `${failurePoint} failed in the production executor fixture`;
}

/**
 * @param {Record<string, any>} options
 */
function finish({
  transaction,
  events,
  requestedReleaseId,
  failurePoint = '',
  category = '',
  failedPhase = '',
  rollbackAttempted = false,
  rollbackResult = 'not_attempted',
}) {
  return {
    ...transaction,
    events,
    failurePoint,
    failureCategory: category,
    failureMessage: failurePoint ? failureMessage(failurePoint) : '',
    failedPhase,
    rollbackAttempted,
    rollbackResult,
    diagnostic: buildProductionDiagnostic({
      requestedReleaseId,
      currentReleaseId: transaction.currentReleaseId,
      candidateReleaseId: transaction.candidateReleaseId,
      previousReleaseId: transaction.previousReleaseId,
      deploymentPhase: failedPhase || transaction.phase,
      finalPhase: transaction.phase,
      mutationBoundaryReached: transaction.mutationBoundaryReached,
      failurePoint,
      failureCategory: category,
      rollbackAttempted,
      rollbackResult,
    }),
  };
}

/**
 * @param {Record<string, any>} [options]
 */
export function runProductionExecutorScenario({
  previousReleaseId,
  candidateReleaseId,
  failurePoint = '',
  rollbackFailurePoint = '',
} = {}) {
  const transaction = createDeploymentTransaction({ previousReleaseId, candidateReleaseId });
  const requestedReleaseId = transaction.candidateReleaseId;
  const events = [];
  let current = transaction;

  const record = (stage, operation, mutating = false) => {
    const previousEvent = events.at(-1);
    if (previousEvent?.stage === stage) {
      previousEvent.operations.push(operation);
      previousEvent.mutating ||= mutating;
      return;
    }
    events.push({ stage, operation, operations: [operation], mutating });
  };

  const fail = (point) => {
    const failedPhase = current.phase;
    current = transitionDeploymentState(current, DEPLOYMENT_PHASES.FAILED);
    if (!current.mutationBoundaryReached) {
      return finish({
        transaction: current,
        events,
        requestedReleaseId,
        failurePoint: point,
        category: failureCategory(point),
        failedPhase,
      });
    }

    current = transitionDeploymentState(current, DEPLOYMENT_PHASES.ROLLING_BACK);
    events.push({ stage: 'ROLLBACK', operation: 'rollback-preflight', mutating: false });
    if (rollbackFailurePoint === 'rollback-preflight') {
      current = transitionDeploymentState(current, DEPLOYMENT_PHASES.FAILED);
      return finish({
        transaction: current,
        events,
        requestedReleaseId,
        failurePoint: rollbackFailurePoint,
        category: failureCategory(rollbackFailurePoint),
        failedPhase,
        rollbackAttempted: true,
        rollbackResult: 'failed',
      });
    }

    events.push({ stage: 'ROLLBACK', operation: 'restore-previous-release', mutating: true });
    if (['rollback-execution', 'rollback-readiness'].includes(rollbackFailurePoint)) {
      current = transitionDeploymentState(current, DEPLOYMENT_PHASES.FAILED);
      return finish({
        transaction: current,
        events,
        requestedReleaseId,
        failurePoint: rollbackFailurePoint,
        category: failureCategory(rollbackFailurePoint),
        failedPhase,
        rollbackAttempted: true,
        rollbackResult: 'failed',
      });
    }

    events.push({ stage: 'ROLLBACK', operation: 'verify-health-readiness', mutating: false });
    if (rollbackFailurePoint === 'rollback-activation') {
      current = transitionDeploymentState(current, DEPLOYMENT_PHASES.FAILED);
      return finish({
        transaction: current,
        events,
        requestedReleaseId,
        failurePoint: rollbackFailurePoint,
        category: failureCategory(rollbackFailurePoint),
        failedPhase,
        rollbackAttempted: true,
        rollbackResult: 'failed',
      });
    }

    current = transitionDeploymentState(current, DEPLOYMENT_PHASES.ROLLED_BACK);
    return finish({
      transaction: current,
      events,
      requestedReleaseId,
      failurePoint: point,
      category: failureCategory(point),
      failedPhase,
      rollbackAttempted: true,
      rollbackResult: 'success',
    });
  };

  record('RESOLVE', 'resolve-exact-release-bundle');
  record('PREFLIGHT', 'verify-host-verifier-and-rollback');
  if (failurePoint === 'verifier-unavailable' || failurePoint === 'verifier-command-missing') {
    return fail(failurePoint);
  }

  record('PREPARE', 'project-runtime-and-persist-candidate-state');
  if (['runtime-projection', 'docker-pull', 'state-persistence'].includes(failurePoint)) {
    return fail(failurePoint);
  }

  current = transitionDeploymentState(current, DEPLOYMENT_PHASES.SWITCHING);
  record('SWITCH', 'run-migrations', true);
  if (failurePoint === 'migration') return fail(failurePoint);
  record('SWITCH', 'stop-current-containers', true);
  if (failurePoint === 'container-stop') return fail(failurePoint);
  record('SWITCH', 'create-candidate-containers', true);
  if (failurePoint === 'container-create') return fail(failurePoint);
  record('SWITCH', 'start-candidate-containers', true);
  if (failurePoint === 'container-start') return fail(failurePoint);
  current = transitionDeploymentState(current, DEPLOYMENT_PHASES.ACTIVATED_UNVERIFIED);

  record('VERIFY', 'health-readiness-and-semantic-ready');
  if (['health', 'malformed-ready', 'ready-false'].includes(failurePoint)) {
    return fail(failurePoint);
  }
  current = transitionDeploymentState(current, DEPLOYMENT_PHASES.VERIFIED);

  record('COMMIT', 'atomically-activate-current-release');
  if (['candidate-pointer-update', 'commit-current-activation'].includes(failurePoint)) {
    return fail(failurePoint);
  }
  current = transitionDeploymentState(current, DEPLOYMENT_PHASES.COMMITTED);
  return finish({
    transaction: current,
    events,
    requestedReleaseId,
  });
}

export { ALLOWED_TRANSITIONS };
