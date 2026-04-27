import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { gitOutput } from '../scripts/lib/git-process.mjs';
import { parseReleaseStateText } from '../scripts/lib/release-state-contract.mjs';
import { runProjectCommand } from './helpers/ops-contracts.ts';

const projectRoot = resolve(import.meta.dirname, '..');

function runReleaseExecutionScript(script: string, env: Record<string, string> = {}) {
  return runProjectCommand('bash', ['-lc', script], {
    env: {
      ...process.env,
      ...env,
      PROJECT_ROOT: projectRoot,
    },
  });
}

function requireSuccessfulShell(script: string, env: Record<string, string> = {}) {
  const result = runReleaseExecutionScript(script, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function commitAll(cwd: string, message: string) {
  gitOutput(['add', '.'], { cwd });
  gitOutput(['commit', '-m', message], { cwd });
  return gitOutput(['rev-parse', 'HEAD'], { cwd });
}

test('release execution marks deploy stages through a backward-compatible context snapshot', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-execution-context-'));
  const contextPath = join(tempDir, 'deploy-context.env');

  try {
    requireSuccessfulShell(`
      set -euo pipefail
      source "$PROJECT_ROOT/scripts/lib/common.sh"
      source "$PROJECT_ROOT/scripts/lib/release-state.sh"
      source "$PROJECT_ROOT/scripts/lib/release-execution.sh"
      release_execution_init_context "${contextPath}"
      TARGET_SHA=target123
      APP_SHA=target123
      IMAGE_SOURCE=release-candidate
      PREVIOUS_APP_SHA=prev123
      release_execution_mark_stage preflight
      release_execution_mark_stage migrations
      release_execution_mark_stage startup
      release_execution_mark_stage readiness
      release_execution_mark_stage completed
    `);

    const snapshot = parseReleaseStateText(readFileSync(contextPath, 'utf-8'));
    assert.equal(snapshot.TARGET_SHA, 'target123');
    assert.equal(snapshot.APP_SHA, 'target123');
    assert.equal(snapshot.FAILURE_STAGE, 'completed');
    assert.equal(snapshot.DEPLOY_FAILURE_STAGE, 'completed');
    assert.equal(snapshot.ROLLBACK_ATTEMPTED, '0');
    assert.equal(snapshot.ROLLBACK_RESULT, 'not_attempted');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release execution classifies migration risk through the shared Node classifier', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'release-execution-risk-'));

  try {
    gitOutput(['init'], { cwd: repoDir });
    gitOutput(['checkout', '-b', 'main'], { cwd: repoDir });
    gitOutput(['config', 'user.name', 'Codex'], { cwd: repoDir });
    gitOutput(['config', 'user.email', 'codex@example.com'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), 'baseline\n');
    const baseSha = commitAll(repoDir, 'baseline');
    mkdirSync(join(repoDir, 'api', 'drizzle'), { recursive: true });
    writeFileSync(join(repoDir, 'api', 'drizzle', '0001_drop.sql'), 'DROP TABLE old_data;\n');
    const targetSha = commitAll(repoDir, 'destructive migration');

    const result = requireSuccessfulShell(`
      set -euo pipefail
      source "$PROJECT_ROOT/scripts/lib/common.sh"
      source "$PROJECT_ROOT/scripts/lib/release-execution.sh"
      release_execution_classify_migration_risk "${repoDir}" "${baseSha}" "${targetSha}"
      printf 'risk=%s\\nchanged=%s\\ndestructive=%s\\n' "$MIGRATION_RISK_LEVEL" "$MIGRATION_CHANGED_FILES" "$MIGRATION_DESTRUCTIVE_FILES"
    `);

    assert.match(result.stdout, /risk=destructive/);
    assert.match(result.stdout, /changed=api\/drizzle\/0001_drop\.sql/);
    assert.match(result.stdout, /destructive=api\/drizzle\/0001_drop\.sql/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('release execution gates destructive production migrations on a backup reference', () => {
  const missingBackup = runReleaseExecutionScript(`
    set -euo pipefail
    source "$PROJECT_ROOT/scripts/lib/common.sh"
    source "$PROJECT_ROOT/scripts/lib/release-execution.sh"
    MIGRATION_RISK_LEVEL=destructive
    release_execution_require_production_backup
  `);

  assert.notEqual(missingBackup.status, 0);
  assert.match(
    `${missingBackup.stdout}\n${missingBackup.stderr}`,
    /Destructive migrations require PRODUCTION_DB_BACKUP_ID or PRODUCTION_DB_BACKUP_COMMAND/
  );

  const withBackup = requireSuccessfulShell(`
    set -euo pipefail
    source "$PROJECT_ROOT/scripts/lib/common.sh"
    source "$PROJECT_ROOT/scripts/lib/release-execution.sh"
    MIGRATION_RISK_LEVEL=destructive
    PRODUCTION_DB_BACKUP_ID=backup-2026-04-27
    release_execution_require_production_backup
    printf '%s\\n' "$PRODUCTION_BACKUP_REFERENCE"
  `);

  assert.equal(withBackup.stdout.trim().split('\n').at(-1), 'backup-2026-04-27');
});

test('release execution exposes staging restore and production rollback eligibility', () => {
  const result = requireSuccessfulShell(`
    set -euo pipefail
    source "$PROJECT_ROOT/scripts/lib/release-execution.sh"
    DB_MIGRATED=1 FAILURE_STAGE=startup release_execution_staging_restore_is_eligible && echo staging-startup
    DB_MIGRATED=1 FAILURE_STAGE=readiness release_execution_staging_restore_is_eligible && echo staging-readiness
    DB_MIGRATED=0 FAILURE_STAGE=preflight release_execution_staging_restore_is_eligible || echo no-staging-preflight
    release_execution_production_rollback_is_eligible failure skipped skipped && echo production-deploy-failure
    release_execution_production_rollback_is_eligible success failure skipped && echo production-smoke-failure
    release_execution_production_rollback_is_eligible success success failure && echo production-canary-failure
    release_execution_production_rollback_is_eligible success success success || echo no-production-rollback
  `);

  assert.deepEqual(result.stdout.trim().split('\n'), [
    'staging-startup',
    'staging-readiness',
    'no-staging-preflight',
    'production-deploy-failure',
    'production-smoke-failure',
    'production-canary-failure',
    'no-production-rollback',
  ]);
});

test('remote deploy scripts load release execution and delegate release-risk decisions', () => {
  const helperPath = resolve(projectRoot, 'scripts/lib/release-execution.sh');
  const scaffold = readFileSync(
    resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
    'utf-8'
  );
  const helperContracts = readFileSync(
    resolve(projectRoot, 'scripts/lib/remote-helper-contracts.sh'),
    'utf-8'
  );
  const stagingRemote = readFileSync(
    resolve(projectRoot, 'scripts/deploy-staging-remote.sh'),
    'utf-8'
  );
  const productionRemote = readFileSync(
    resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
    'utf-8'
  );
  const productionContext = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-production-context.sh'),
    'utf-8'
  );

  assert.ok(existsSync(helperPath));
  assert.match(scaffold, /RELEASE_EXECUTION_HELPER_PATH=/);
  assert.match(helperContracts, /RELEASE_EXECUTION_HELPER_MIN_CONTRACT_VERSION=/);
  assert.match(helperContracts, /release_execution_helper_supports_contract\(\)/);
  assert.match(stagingRemote, /source "\$RELEASE_EXECUTION_HELPER_PATH"/);
  assert.match(stagingRemote, /release_execution_mark_stage migrations/);
  assert.match(stagingRemote, /release_execution_staging_restore_is_eligible/);
  assert.match(productionRemote, /source "\$RELEASE_EXECUTION_HELPER_PATH"/);
  assert.match(productionRemote, /release_execution_mark_stage migrations/);
  assert.match(productionRemote, /release_execution_mark_stage startup/);
  assert.match(productionContext, /release_execution_classify_and_gate_production_migrations/);
  assert.doesNotMatch(productionContext, /classify_sql_migration_file\(\)/);
});
