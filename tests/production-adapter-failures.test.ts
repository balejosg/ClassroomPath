import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const previous = 'a'.repeat(64);
const candidate = 'b'.repeat(64);

test('production migration classification does not invoke an optional host Node runtime', () => {
  const source = readFileSync(join(projectRoot, 'scripts/deploy-production-remote.sh'), 'utf8');
  const classify = source.slice(
    source.indexOf('classify_production_migration_risk() {'),
    source.indexOf('\nrun_production_database_migrations()')
  );
  const result = spawnSync(
    'bash',
    [
      '-c',
      `
    ${classify}
    DEPLOYMENT_STATE_CURRENT_POINTER_FILE=/dev/null
    deployment_state_capture_previous_release() { :; }
    rollback_executor_previous_release_id() { echo previous; }
    deployment_transaction_set_release_identity() { :; }
    rollback_executor_preflight() { :; }
    node() { echo host-node-used; return 1; }
    release_execution_classify_migration_risk() { node; }
    classify_migration_risk_without_node() { echo hermetic-classification; }
    release_execution_require_production_backup() { :; }
    release_execution_write_deploy_context() { :; }
    classify_production_migration_risk
  `,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /host-node-used/);
  assert.match(result.stdout, /hermetic-classification/);
});

// Exercise the shipped shell functions through the same conditional call as
// production. External effects are seams; transaction marker persistence is real.
for (const fault of [
  'activation-helper-missing',
  'assets',
  'pull',
  'pending',
  'persist',
  'projection',
  'billing',
  'migration',
  'stop',
  'start',
  'commit-current',
  'publish-pending',
  'commit-state',
  'stage-completed',
  'rollback',
]) {
  test(`real production adapter stops on ${fault} failure`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-adapter-failure-'));
    mkdirSync(join(root, 'docker'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config/.env'), 'fixture=value\n');
    const source = readFileSync(join(projectRoot, 'scripts/deploy-production-remote.sh'), 'utf8');
    const migrations = source.slice(
      source.indexOf('run_production_database_migrations() {'),
      source.indexOf('\nproduction_runtime_adapter_migrate()')
    );
    const harness = `
set -Eeuo pipefail
source "$REPO/scripts/lib/deployment-transaction.sh"
source "$REPO/scripts/lib/deploy-runtime-executor.sh"
source "$REPO/scripts/lib/deploy-production-runtime.sh"
${migrations}
APP_DIR="$FIXTURE"
STATE_DIR="$FIXTURE"
DEPLOYMENT_TRANSACTION_FILE="$FIXTURE/phase.env"
DEPLOYMENT_TRANSACTION_HISTORY_FILE="$FIXTURE/history"
TARGET_SHA=fixture
PREVIOUS_APP_SHA=previous
DB_MIGRATED=0
RELEASE_ID="$CANDIDATE"
RC_RUN_ID=1
OPENPATH_SHA=fixture
OPENPATH_CONTRACT_SHA256=fixture
RELEASE_BUNDLE_FILE=fixture
OPENPATH_CONTRACT_FILE=fixture
for key in CLASSROOMPATH_GATEWAY_IMAGE CLASSROOMPATH_MIGRATIONS_IMAGE CLASSROOMPATH_SPA_IMAGE CLASSROOMPATH_VERIFIER_IMAGE OPENPATH_FIREFOX_ASSETS_IMAGE OPENPATH_API_IMAGE OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256; do export "$key=fixture"; done
step() { echo "$1" >> "$FIXTURE/events"; [ "$FAULT" != "$1" ]; }
log_info() { :; }
log_error() { :; }
configure_deploy_container_platform() { :; }
verify_deploy_container_platform() { :; }
ensure_production_release_candidate_runtime_env() { :; }
cleanup_production_disk_if_needed() { :; }
login_production_registry() { :; }
prepare_openpath_firefox_assets_from_image() { step assets; }
activate_openpath_firefox_assets_generation() { :; }
write_release_runtime_state() { step pending; }
deployment_state_persist_v2_release() { step persist; }
apply_release_runtime_projection_to_env_file() { step projection; }
upsert_env_file_var() { :; }
bash() { case "$1" in *sync-billing*) step billing;; *run-migrations*) step migration;; *) :;; esac; }
docker() { case "$1 \${2:-}" in 'compose pull') step pull;; 'compose down') step stop;; 'compose up') step start;; *) :;; esac; }
release_execution_mark_stage() { [ "$1" != completed ] || step stage-completed; }
production_runtime_adapter_migrate() { run_production_database_migrations; }
production_runtime_adapter_validate_live() { step validate; }
deploy_runtime_wait_for_health_and_readiness() { step health; }
deployment_state_activate_v2_release() { step commit-current || return 1; echo "$CANDIDATE" > "$FIXTURE/current"; }
deployment_state_publish_pending_release() { step publish-pending; }
deploy_runtime_adapter_recover() { step rollback || return 1; echo "$PREVIOUS" > "$FIXTURE/current"; }
deployment_ledger_append_terminal_from_env() { echo "$DEPLOYMENT_RESULT" >> "$FIXTURE/ledger"; }
deployment_transaction_init "$DEPLOYMENT_TRANSACTION_FILE" "$PREVIOUS" "$CANDIDATE"
echo "$PREVIOUS" > "$FIXTURE/current"
if [ "$FAULT" = commit-state ]; then
  eval "$(declare -f deployment_transaction_write | sed '1s/deployment_transaction_write/original_transaction_write/')"
  deployment_transaction_write() { if [ "$DEPLOYMENT_PHASE" = COMMITTED ]; then step commit-state; return 1; fi; original_transaction_write "$@"; }
fi
if [ "$FAULT" = activation-helper-missing ]; then echo activation-helper-missing >> "$FIXTURE/events"; unset -f production_runtime_activate_prepared_files; fi
fault_barrier() { [ "$FAULT" != rollback ]; }
if deploy_runtime_execute production_runtime_adapter_prepare production_runtime_adapter_migrate production_runtime_adapter_switch production_runtime_adapter_validate_live fault_barrier; then
  echo success > "$FIXTURE/result"
else
  echo failure > "$FIXTURE/result"
fi
printf 'DB_MIGRATED=%s\n' "$DB_MIGRATED" >> "$FIXTURE/phase.env"
`;
    writeFileSync(join(root, 'harness.sh'), harness);
    try {
      const result = spawnSync('bash', [join(root, 'harness.sh')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          REPO: projectRoot,
          FIXTURE: root,
          FAULT: fault,
          PREVIOUS: previous,
          CANDIDATE: candidate,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(root, 'result'), 'utf8').trim(), 'failure');
      const state = readFileSync(join(root, 'phase.env'), 'utf8');
      const preBoundary = [
        'activation-helper-missing',
        'assets',
        'pull',
        'pending',
        'persist',
        'projection',
        'billing',
      ].includes(fault);
      assert.match(state, new RegExp(`MUTATION_BOUNDARY_REACHED=${preBoundary ? 0 : 1}`));
      assert.match(
        state,
        new RegExp(
          `DEPLOYMENT_PHASE=${preBoundary || fault === 'rollback' ? 'FAILED' : 'ROLLED_BACK'}`
        )
      );
      assert.doesNotMatch(readFileSync(join(root, 'ledger'), 'utf8'), /COMMITTED/);
      assert.equal(readFileSync(join(root, 'current'), 'utf8').trim(), previous);
      const events = readFileSync(join(root, 'events'), 'utf8');
      assert.ok(events.split('\n').includes(fault), `fault ${fault} must actually be reached`);
      assert.match(state, new RegExp(`ROLLBACK_ATTEMPTED=${preBoundary ? 0 : 1}`));
      assert.match(
        state,
        new RegExp(
          `ROLLBACK_RESULT=${preBoundary ? 'not_attempted' : fault === 'rollback' ? 'failed' : 'success'}`
        )
      );
      if (!preBoundary) assert.match(events, /^rollback$/m);
      const classifications: Record<string, string> = {
        'activation-helper-missing': 'host-contract',
        assets: 'firefox-assets',
        pull: 'docker-pull',
        pending: 'state-persistence',
        persist: 'state-persistence',
        projection: 'runtime-projection',
        billing: 'runtime-projection',
        migration: 'migration',
        stop: 'container-switch',
        start: 'container-switch',
        'commit-current': 'commit-current-activation',
        'publish-pending': 'candidate-pointer-update',
        'commit-state': 'commit-state',
        'stage-completed': 'commit-context',
      };
      if (classifications[fault])
        assert.match(state, new RegExp(`^FAILURE_POINT=${classifications[fault]}$`, 'm'));
      if (preBoundary) assert.doesNotMatch(events, /migration|stop|start|rollback/);
      if (fault === 'migration') assert.match(state, /DB_MIGRATED=0/);
      if (fault === 'stop') assert.doesNotMatch(events, /start/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
