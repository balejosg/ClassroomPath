import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const executorHelper = resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh');
const productionRemoteScript = resolve(projectRoot, 'scripts/deploy-production-remote.sh');
const productionRuntimeHelper = resolve(projectRoot, 'scripts/lib/deploy-production-runtime.sh');

type BoundaryScenario =
  | 'missing-transition'
  | 'wrong-phase'
  | 'transition-without-boundary'
  | 'phase-without-boundary'
  | 'boundary-without-phase';

function runBoundaryScenario(scenario: BoundaryScenario) {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-runtime-boundary-'));
  const tracePath = join(tempDir, 'trace.log');
  writeFileSync(tracePath, '', 'utf8');

  const script = [
    'set -Eeuo pipefail',
    'source "$1"',
    'trace_file="$2"',
    'scenario="$3"',
    'record() { printf "%s\\n" "$1" >> "$trace_file"; }',
    'prepare_adapter() { record prepare; }',
    'migrate_adapter() { record migrate; }',
    'switch_adapter() { record switch; }',
    'validate_adapter() { record validate; }',
    'deploy_runtime_wait_for_health_and_readiness() { record health; }',
    'case "$scenario" in',
    '  missing-transition)',
    '    DEPLOYMENT_PHASE=PREPARED',
    '    MUTATION_BOUNDARY_REACHED=0',
    '    ;;',
    '  wrong-phase)',
    '    DEPLOYMENT_PHASE=VERIFIED',
    '    MUTATION_BOUNDARY_REACHED=0',
    '    deployment_transaction_transition() { record "transition:$1:$2"; }',
    '    ;;',
    '  transition-without-boundary)',
    '    DEPLOYMENT_PHASE=PREPARED',
    '    MUTATION_BOUNDARY_REACHED=0',
    '    deployment_transaction_transition() { record "transition:$1:$2"; }',
    '    ;;',
    '  phase-without-boundary)',
    '    DEPLOYMENT_PHASE=PREPARED',
    '    MUTATION_BOUNDARY_REACHED=0',
    '    deployment_transaction_transition() { DEPLOYMENT_PHASE=SWITCHING; record "transition:$1:$2"; }',
    '    ;;',
    '  boundary-without-phase)',
    '    DEPLOYMENT_PHASE=PREPARED',
    '    MUTATION_BOUNDARY_REACHED=0',
    '    deployment_transaction_transition() { MUTATION_BOUNDARY_REACHED=1; record "transition:$1:$2"; }',
    '    ;;',
    '  *) exit 2 ;;',
    'esac',
    'export DEPLOYMENT_PHASE MUTATION_BOUNDARY_REACHED',
    'set +e',
    'deploy_runtime_execute prepare_adapter migrate_adapter switch_adapter validate_adapter',
    'status=$?',
    'set -e',
    'printf "status=%s\\n" "$status" >> "$trace_file"',
  ].join('\n');

  const result = spawnSync(
    'bash',
    ['-c', script, 'runtime-boundary', executorHelper, tracePath, scenario],
    { cwd: projectRoot, env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }
  );

  return { tempDir, tracePath, result };
}

function traceLines(tracePath: string) {
  return readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean);
}

test('runtime executor rejects a missing transaction transition before migrate/switch', () => {
  const fixture = runBoundaryScenario('missing-transition');
  try {
    assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = traceLines(fixture.tracePath);
    assert.deepEqual(trace, ['prepare', 'status=1']);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('runtime executor rejects a non-PREPARED phase before migrate/switch', () => {
  const fixture = runBoundaryScenario('wrong-phase');
  try {
    assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = traceLines(fixture.tracePath);
    assert.deepEqual(trace, ['prepare', 'status=1']);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('runtime executor rejects a no-op transition before migrate/switch', () => {
  const fixture = runBoundaryScenario('transition-without-boundary');
  try {
    assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = traceLines(fixture.tracePath);
    assert.deepEqual(trace, ['prepare', 'transition:SWITCHING:SWITCH', 'status=1']);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

for (const scenario of ['phase-without-boundary', 'boundary-without-phase'] as const) {
  test(`runtime executor rejects an incomplete transition: ${scenario}`, () => {
    const fixture = runBoundaryScenario(scenario);
    try {
      assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
      assert.deepEqual(traceLines(fixture.tracePath), [
        'prepare',
        'transition:SWITCHING:SWITCH',
        'status=1',
      ]);
    } finally {
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });
}

function runTerminalFailure(phase: 'COMMITTED' | 'ROLLED_BACK') {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-runtime-terminal-'));
  const statePath = join(tempDir, 'state.env');
  const ledgerPath = join(tempDir, 'ledger.log');
  const tracePath = join(tempDir, 'trace.log');
  writeFileSync(statePath, 'state-before\n', 'utf8');
  writeFileSync(ledgerPath, 'ledger-before\n', 'utf8');
  writeFileSync(tracePath, '', 'utf8');

  const script = [
    'set -Eeuo pipefail',
    'source "$1"',
    'state_file="$2"',
    'ledger_file="$3"',
    'trace_file="$4"',
    'record() { printf "%s\\n" "$1" >> "$trace_file"; }',
    'deployment_transaction_mark_failure() { record mark-failure; printf "state-mutated\\n" >> "$state_file"; }',
    'deployment_transaction_begin_rollback() { record begin-rollback; printf "state-mutated\\n" >> "$state_file"; }',
    'deploy_runtime_adapter_recover() { record recover; printf "state-mutated\\n" >> "$state_file"; }',
    'deployment_transaction_mark_rollback_success() { record rollback-success; printf "state-mutated\\n" >> "$state_file"; }',
    'deployment_transaction_mark_rollback_failure() { record rollback-failure; printf "state-mutated\\n" >> "$state_file"; }',
    'deployment_ledger_append_terminal_from_env() { record ledger; printf "ledger-mutated\\n" >> "$ledger_file"; }',
    `DEPLOYMENT_PHASE="$5"`,
    'MUTATION_BOUNDARY_REACHED=1',
    'set +e',
    'deploy_runtime_executor_fail terminal-state',
    'status=$?',
    'set -e',
    'printf "status=%s\\n" "$status" >> "$trace_file"',
  ].join('\n');

  const result = spawnSync(
    'bash',
    ['-c', script, 'runtime-terminal', executorHelper, statePath, ledgerPath, tracePath, phase],
    { cwd: projectRoot, env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }
  );

  return { tempDir, statePath, ledgerPath, tracePath, result };
}

test('terminal executor failure does not recover or rewrite state/ledger', () => {
  for (const phase of ['COMMITTED', 'ROLLED_BACK'] as const) {
    const fixture = runTerminalFailure(phase);
    try {
      assert.equal(
        fixture.result.status,
        0,
        `${phase}: ${fixture.result.stdout}\n${fixture.result.stderr}`
      );
      assert.deepEqual(traceLines(fixture.tracePath), ['status=1'], phase);
      assert.equal(readFileSync(fixture.statePath, 'utf8'), 'state-before\n', phase);
      assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), 'ledger-before\n', phase);
    } finally {
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  }
});

test('production runtime compatibility entrypoint delegates to the canonical executor', () => {
  const remoteSource = readFileSync(productionRemoteScript, 'utf8');
  const runtimeSource = readFileSync(productionRuntimeHelper, 'utf8');
  const wrapper = remoteSource.match(/\nstart_production_runtime\(\) \{[\s\S]*?\n\}/u)?.[0] ?? '';

  assert.notEqual(wrapper, '', 'start_production_runtime wrapper should exist');
  assert.match(wrapper, /execute_production_runtime\s+"\$@"/u);
  assert.doesNotMatch(wrapper, /start_production_runtime_impl/u);
  assert.doesNotMatch(runtimeSource, /\nstart_production_runtime_impl\(\)/u);
});
