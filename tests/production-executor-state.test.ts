import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  DEPLOYMENT_PHASES,
  createDeploymentTransaction,
  transitionDeploymentState,
} from '../scripts/lib/production-executor-scenario.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

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
