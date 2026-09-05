import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  DEPLOYMENT_PHASES,
  createDeploymentTransaction,
  transitionDeploymentState,
} from '../scripts/lib/production-executor-scenario.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

const productionRuntimeHelper = resolve(projectRoot, 'scripts/lib/deploy-production-runtime.sh');
const commonHelper = resolve(projectRoot, 'scripts/lib/common.sh');
const transactionHelper = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function createReadinessFailureFixture(mode: 'health' | 'readiness') {
  const tempDir = mkdtempSync(join(tmpdir(), `classroompath-runtime-${mode}-failure-`));
  const binDir = join(tempDir, 'bin');
  const stateFile = join(tempDir, 'deployment-phase.env');
  const historyFile = join(tempDir, 'deployment-history.log');
  const previousReleaseId = 'a'.repeat(64);
  const candidateReleaseId = 'b'.repeat(64);
  const transactionId = `${mode === 'health' ? 'c' : 'd'}`.repeat(64);

  mkdirSync(binDir, { recursive: true });
  writeExecutable(
    join(binDir, 'timeout'),
    `#!/usr/bin/env bash
exit 1
`
  );
  writeExecutable(
    join(binDir, 'sleep'),
    `#!/usr/bin/env bash
exit 0
`
  );
  writeExecutable(
    join(binDir, 'docker'),
    `#!/usr/bin/env bash
case "\${1:-}:\${2:-}" in
  compose:ps) printf '%s\\n' 'classroompath-gateway starting' ;;
  logs:*) exit 0 ;;
esac
exit 0
`
  );
  writeExecutable(
    join(binDir, 'curl'),
    `#!/usr/bin/env bash
url="\${!#}"
case "$url" in
  */cp/health)
    if [ "\${RUNTIME_FAILURE_MODE:-}" = health ]; then exit 22; fi
    exit 0
    ;;
  */cp/ready)
    printf '%s\\n' '{"ready":false}'
    exit 0
    ;;
esac
exit 22
`
  );

  const setupScript = [
    'set -euo pipefail',
    'source "$1"',
    `DEPLOYMENT_TRANSACTION_HISTORY_FILE="$3"`,
    'export DEPLOYMENT_TRANSACTION_HISTORY_FILE',
    'deployment_transaction_init "$2" "$4" "$5" "$6"',
    'deployment_transaction_transition SWITCHING SWITCH',
    'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
  ].join('\n');
  execFileSync(
    'bash',
    [
      '-c',
      setupScript,
      'transaction-setup',
      transactionHelper,
      stateFile,
      historyFile,
      previousReleaseId,
      candidateReleaseId,
      transactionId,
    ],
    { cwd: projectRoot, env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` } }
  );

  const forwardScript = [
    'set -Eeuo pipefail',
    'source "$1"',
    'source "$2"',
    'source "$3"',
    'source "$4"',
    'DEPLOYMENT_TRANSACTION_FILE="$5"',
    'DEPLOYMENT_TRANSACTION_HISTORY_FILE="$6"',
    'export DEPLOYMENT_TRANSACTION_FILE DEPLOYMENT_TRANSACTION_HISTORY_FILE',
    'DB_MIGRATED=0',
    'export DB_MIGRATED',
    'release_execution_mark_stage() { :; }',
    'rollback_readiness_json_is_ready() { [ "${1:-}" = "{\\"ready\\":true}" ]; }',
    'capture_production_deploy_failure() {',
    '  local failed_status="$?"',
    '  trap - ERR',
    '  deployment_transaction_mark_failure "${FAILURE_POINT:-readiness}" "${FAILURE_CATEGORY:-readiness}" "${FAILURE_MESSAGE:-candidate readiness failed}" VERIFY || true',
    '  return "$failed_status"',
    '}',
    'trap capture_production_deploy_failure ERR',
    'wait_for_production_runtime_readiness_impl',
  ].join('\n');
  const forward = spawnSync(
    'bash',
    [
      '-c',
      forwardScript,
      'runtime-forward',
      commonHelper,
      transactionHelper,
      productionRuntimeHelper,
      stateFile,
      stateFile,
      historyFile,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:/usr/bin:/bin`,
        RUNTIME_FAILURE_MODE: mode,
      },
      encoding: 'utf8',
    }
  );

  return {
    tempDir,
    stateFile,
    historyFile,
    previousReleaseId,
    candidateReleaseId,
    transactionId,
    forward,
  };
}

function recoverReadinessFailureFixture(fixture: ReturnType<typeof createReadinessFailureFixture>) {
  const recoveryScript = [
    'set -euo pipefail',
    'source "$1"',
    'source "$2"',
    'source "$3"',
    'DEPLOYMENT_TRANSACTION_FILE="$4"',
    'DEPLOYMENT_TRANSACTION_HISTORY_FILE="$5"',
    'export DEPLOYMENT_TRANSACTION_FILE DEPLOYMENT_TRANSACTION_HISTORY_FILE',
    'source "$4"',
    'deployment_transaction_begin_rollback',
    'deployment_transaction_mark_rollback_success',
  ].join('\n');

  execFileSync(
    'bash',
    [
      '-c',
      recoveryScript,
      'runtime-recovery',
      commonHelper,
      transactionHelper,
      resolve(projectRoot, 'scripts/lib/rollback-readiness.sh'),
      fixture.stateFile,
      fixture.historyFile,
    ],
    { cwd: projectRoot, env: { ...process.env, PATH: '/usr/bin:/bin' } }
  );
}

function assertReadinessFailureSequence(fixture: ReturnType<typeof createReadinessFailureFixture>) {
  const marker = readFileSync(fixture.stateFile, 'utf8');
  assert.match(marker, /^DEPLOYMENT_PHASE=FAILED$/mu);
  assert.match(marker, new RegExp(`^DEPLOYMENT_TRANSACTION_ID=${fixture.transactionId}$`, 'mu'));
  assert.match(marker, new RegExp(`^CURRENT_RELEASE_ID=${fixture.previousReleaseId}$`, 'mu'));
  assert.doesNotMatch(
    marker,
    new RegExp(`^CURRENT_RELEASE_ID=${fixture.candidateReleaseId}$`, 'mu')
  );

  recoverReadinessFailureFixture(fixture);
  const rolledBackMarker = readFileSync(fixture.stateFile, 'utf8');
  assert.match(rolledBackMarker, /^DEPLOYMENT_PHASE=ROLLED_BACK$/mu);
  assert.match(
    rolledBackMarker,
    new RegExp(`^CURRENT_RELEASE_ID=${fixture.previousReleaseId}$`, 'mu')
  );
  assert.match(
    rolledBackMarker,
    new RegExp(`^PREVIOUS_RELEASE_ID=${fixture.previousReleaseId}$`, 'mu')
  );

  const history = readFileSync(fixture.historyFile, 'utf8');
  const phases = [...history.matchAll(/^DEPLOYMENT_PHASE=([^ ]+)/gmu)].map((match) => match[1]);
  assert.deepEqual(phases, [
    'PREPARED',
    'SWITCHING',
    'ACTIVATED_UNVERIFIED',
    'FAILED',
    'ROLLING_BACK',
    'ROLLED_BACK',
  ]);
  for (const phase of phases) {
    const record = history
      .split('\n')
      .find((line) => line.startsWith(`DEPLOYMENT_PHASE=${phase} `));
    assert.ok(record, `missing history record for ${phase}`);
    assert.match(record, new RegExp(`DEPLOYMENT_TRANSACTION_ID=${fixture.transactionId}(?: |$)`));
    assert.match(record, new RegExp(`CURRENT_RELEASE_ID=${fixture.previousReleaseId}(?: |$)`));
    assert.doesNotMatch(
      record,
      new RegExp(`CURRENT_RELEASE_ID=${fixture.candidateReleaseId}(?: |$)`)
    );
  }
}

test('health failure persists FAILED before explicit rollback', () => {
  const fixture = createReadinessFailureFixture('health');

  try {
    const output = `${fixture.forward.stdout}\n${fixture.forward.stderr}`;
    assert.equal(fixture.forward.status, 1, output);
    assertReadinessFailureSequence(fixture);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('final readiness failure persists FAILED before explicit rollback', () => {
  const fixture = createReadinessFailureFixture('readiness');

  try {
    const output = `${fixture.forward.stdout}\n${fixture.forward.stderr}`;
    assert.equal(fixture.forward.status, 1, output);
    assertReadinessFailureSequence(fixture);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('deployment transaction accepts only the forward and recovery transitions', () => {
  const transaction = createDeploymentTransaction({
    previousReleaseId: 'a'.repeat(64),
    candidateReleaseId: 'b'.repeat(64),
  });

  assert.equal(transaction.phase, DEPLOYMENT_PHASES.PREPARED);
  const switching = transitionDeploymentState(transaction, DEPLOYMENT_PHASES.SWITCHING);
  const activated = transitionDeploymentState(switching, DEPLOYMENT_PHASES.ACTIVATED_UNVERIFIED);
  const verified = transitionDeploymentState(activated, DEPLOYMENT_PHASES.VERIFIED);
  const committed = transitionDeploymentState(verified, DEPLOYMENT_PHASES.COMMITTED);

  assert.equal(committed.phase, DEPLOYMENT_PHASES.COMMITTED);
  assert.equal(committed.currentReleaseId, 'b'.repeat(64));
  assert.equal(committed.previousReleaseId, 'a'.repeat(64));
  assert.throws(
    () => transitionDeploymentState(transaction, DEPLOYMENT_PHASES.COMMITTED),
    /invalid deployment transition/u
  );
});

test('current release remains unchanged until verification and commit', () => {
  const transaction = createDeploymentTransaction({
    previousReleaseId: 'c'.repeat(64),
    candidateReleaseId: 'd'.repeat(64),
  });
  const switching = transitionDeploymentState(transaction, DEPLOYMENT_PHASES.SWITCHING);
  const activated = transitionDeploymentState(switching, DEPLOYMENT_PHASES.ACTIVATED_UNVERIFIED);

  assert.equal(activated.currentReleaseId, 'c'.repeat(64));
  assert.equal(activated.mutationBoundaryReached, true);
  assert.equal(activated.committed, false);
});

test('shell transaction marker persists commit and rollback transitions atomically', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-production-transaction-'));
  const stateFile = join(tempDir, 'deployment-phase.env');
  const helperPath = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');
  const shellScript = [
    'set -euo pipefail',
    'source "$1"',
    'deployment_transaction_init "$2" \\',
    '  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \\',
    '  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    'deployment_transaction_transition SWITCHING SWITCH',
    'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
    'deployment_transaction_transition VERIFIED VERIFY',
    'deployment_transaction_transition COMMITTED COMMIT',
    'if deployment_transaction_transition ROLLED_BACK ROLLBACK; then',
    '  exit 10',
    'fi',
    'deployment_transaction_init "$2" \\',
    '  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \\',
    '  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    'deployment_transaction_mark_failure health health "candidate failed" VERIFY',
    'if deployment_transaction_begin_rollback; then',
    '  exit 11',
    'fi',
    'deployment_transaction_init "$2" \\',
    '  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \\',
    '  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    'deployment_transaction_transition SWITCHING SWITCH',
    'deployment_transaction_mark_failure health health "candidate failed" VERIFY',
    'deployment_transaction_begin_rollback',
    'deployment_transaction_mark_rollback_success',
  ].join('\n');

  try {
    execFileSync('bash', ['-c', shellScript, 'bash', helperPath, stateFile], {
      cwd: projectRoot,
      stdio: 'pipe',
    });

    const marker = readFileSync(stateFile, 'utf8');
    assert.match(marker, /^DEPLOYMENT_PHASE=ROLLED_BACK$/mu);
    assert.match(
      marker,
      /^CURRENT_RELEASE_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/mu
    );
    assert.match(marker, /^MUTATION_BOUNDARY_REACHED=1$/mu);
    assert.match(marker, /^ROLLBACK_RESULT=success$/mu);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test('explicit recovery alone permits COMMITTED to roll back while normal commit stays terminal', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-committed-recovery-'));
  const stateFile = join(tempDir, 'deployment-phase.env');
  const helperPath = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');
  const shellScript = [
    'set -euo pipefail',
    'source "$1"',
    'deployment_transaction_init "$2" \\',
    '  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \\',
    '  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    'deployment_transaction_transition SWITCHING SWITCH',
    'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
    'deployment_transaction_transition VERIFIED VERIFY',
    'deployment_transaction_transition COMMITTED COMMIT',
    'if deployment_transaction_transition ROLLING_BACK ROLLBACK; then',
    '  exit 10',
    'fi',
    'DEPLOYMENT_EXPLICIT_RECOVERY=1',
    'export DEPLOYMENT_EXPLICIT_RECOVERY',
    'deployment_transaction_begin_rollback',
    'deployment_transaction_mark_rollback_success',
  ].join('\n');

  try {
    execFileSync('bash', ['-c', shellScript, 'bash', helperPath, stateFile], {
      cwd: projectRoot,
      stdio: 'pipe',
    });

    const marker = readFileSync(stateFile, 'utf8');
    assert.match(marker, /^DEPLOYMENT_PHASE=ROLLED_BACK$/mu);
    assert.match(
      marker,
      /^CURRENT_RELEASE_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/mu
    );
    assert.match(
      marker,
      /^PREVIOUS_RELEASE_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/mu
    );
    assert.match(marker, /^ROLLBACK_RESULT=success$/mu);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
