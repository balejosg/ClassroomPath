import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const commonHelper = resolve(projectRoot, 'scripts/lib/common.sh');
const releaseStateHelper = resolve(projectRoot, 'scripts/lib/release-state.sh');
const releaseRuntimeHelper = resolve(projectRoot, 'scripts/lib/release-runtime.sh');
const transactionHelper = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');
const productionRuntimeHelper = resolve(projectRoot, 'scripts/lib/deploy-production-runtime.sh');
const productionRemoteScript = resolve(projectRoot, 'scripts/deploy-production-remote.sh');

test('Firefox generation preparation preserves the active asset pointer until activation', () => {
  const root = mkdtempSync(join(tmpdir(), 'cp-firefox-prepare-'));
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
      set -euo pipefail
      source "$1"
      export OPENPATH_FIREFOX_RELEASE_HOST_ROOT="$2"
      mkdir -p "$2/previous"
      ln -s "$2/previous" "$2/current"
      docker() {
        case "$1" in
          create) echo fixture-container;;
          cp) printf fixture > "$3";;
          *) :;;
        esac
      }
      prepare_openpath_firefox_assets_from_image fixture candidate prepare-only
      [ "$(readlink "$2/current")" = "$2/previous" ]
      activate_openpath_firefox_assets_generation
      [ "$(readlink "$2/current")" = "$2/generations/generation-candidate" ]
    `,
        'assets',
        releaseRuntimeHelper,
        root,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const runtimeProjectionKeys = [
  'RELEASE_ID',
  'RC_RUN_ID',
  'APP_SHA',
  'OPENPATH_SHA',
  'OPENPATH_CONTRACT_SHA256',
  'IMAGE_SOURCE',
  'CLASSROOMPATH_GATEWAY_IMAGE',
  'CLASSROOMPATH_MIGRATIONS_IMAGE',
  'OPENPATH_FIREFOX_ASSETS_IMAGE',
  'OPENPATH_API_IMAGE',
  'OPENPATH_VERSION',
  'OPENPATH_LINUX_AGENT_VERSION',
  'OPENPATH_LINUX_AGENT_APT_SUITE',
  'CLASSROOMPATH_SPA_IMAGE',
  'CLASSROOMPATH_VERIFIER_IMAGE',
  'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION',
  'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT',
  'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG',
  'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256',
];

function runtimeProjection(kind: 'candidate' | 'previous' = 'candidate') {
  const releaseChar = kind === 'candidate' ? 'c' : 'p';
  const digestChar = kind === 'candidate' ? 'd' : 'e';
  const label = kind === 'candidate' ? 'candidate' : 'previous';

  return runtimeProjectionKeys
    .map((key, index) => {
      if (key === 'RELEASE_ID') return `${key}=${releaseChar.repeat(64)}`;
      if (key === 'RC_RUN_ID') return `${key}=12345`;
      if (key === 'APP_SHA' || key === 'OPENPATH_SHA') return `${key}=${releaseChar.repeat(40)}`;
      if (key === 'OPENPATH_CONTRACT_SHA256' || key.endsWith('SHA256')) {
        return `${key}=${digestChar.repeat(64)}`;
      }
      if (key.endsWith('_IMAGE')) {
        return `${key}=ghcr.io/example/${label}-${key.toLowerCase()}@sha256:${digestChar.repeat(64)}`;
      }
      if (key === 'IMAGE_SOURCE') return `${key}=release-candidate`;
      if (key === 'OPENPATH_LINUX_AGENT_APT_SUITE') return `${key}=unstable`;
      return `${key}=${label}-${index}`;
    })
    .join('\n')
    .concat('\n');
}

function candidateProjection() {
  return runtimeProjection('candidate');
}

function previousProjection() {
  return runtimeProjection('previous');
}

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function assertProjectionInEnv(env: string, projection: string, label: string) {
  const actualLines = new Set(env.trim().split('\n'));
  for (const line of projection.trim().split('\n')) {
    assert.ok(actualLines.has(line), `${label} is missing ${line}`);
  }
}

function assertHistory(historyPath: string, expectedPhases: string[], transactionId: string) {
  const history = readFileSync(historyPath, 'utf8');
  const phases = [...history.matchAll(/^DEPLOYMENT_PHASE=([^ ]+)/gmu)].map((match) => match[1]);
  assert.deepEqual(phases, expectedPhases);

  for (const phase of expectedPhases) {
    const record = history
      .split('\n')
      .find((line) => line.startsWith(`DEPLOYMENT_PHASE=${phase} `));
    assert.ok(record, `missing history record for ${phase}`);
    assert.match(record, new RegExp(`DEPLOYMENT_TRANSACTION_ID=${transactionId}(?: |$)`));
  }
}

function recoverTransaction(stateFile: string, historyFile: string) {
  const recoveryScript = [
    'set -euo pipefail',
    'source "$1"',
    'state_file="$2"',
    'history_file="$3"',
    'export DEPLOYMENT_TRANSACTION_FILE="$state_file"',
    'export DEPLOYMENT_TRANSACTION_HISTORY_FILE="$history_file"',
    'set -a',
    '. "$state_file"',
    'set +a',
    'export DEPLOYMENT_EXPLICIT_RECOVERY=1',
    'deployment_transaction_begin_rollback',
    'deployment_transaction_mark_rollback_success',
  ].join('\n');

  const result = spawnSync(
    'bash',
    ['-c', recoveryScript, 'runtime-recovery', transactionHelper, stateFile, historyFile],
    { cwd: projectRoot, env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('runtime projection helper applies every canonical field without dropping existing env', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-runtime-projection-'));
  const projectionPath = join(tempDir, 'candidate-runtime.env');
  const envPath = join(tempDir, 'config.env');

  try {
    writeFileSync(projectionPath, candidateProjection(), 'utf8');
    writeFileSync(envPath, 'RELEASE_ID=previous\nAPP_SHA=previous\nSECRET=preserved\n', 'utf8');

    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -euo pipefail',
          'source "$1"',
          'source "$2"',
          'source "$3"',
          'apply_release_runtime_projection_to_env_file "$4" "$5"',
        ].join('\n'),
        'runtime-projection-test',
        commonHelper,
        releaseStateHelper,
        releaseRuntimeHelper,
        projectionPath,
        envPath,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const env = readFileSync(envPath, 'utf8');
    assertProjectionInEnv(env, candidateProjection(), 'config/.env');
    assert.match(env, /^SECRET=preserved$/mu);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function runForwardProjectionFixture(persistedProjection: string, prepareOnly = false) {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-forward-projection-'));
  const appDir = join(tempDir, 'app');
  const stateDir = join(tempDir, 'release-state');
  const binDir = join(tempDir, 'bin');
  const projectionPath = join(tempDir, 'candidate-runtime.env');
  const persistedProjectionPath = join(tempDir, 'persisted-runtime.env');
  const envPath = join(appDir, 'config/.env');
  const gatewayEnvPath = join(tempDir, 'gateway.env');
  const apiEnvPath = join(tempDir, 'api.env');
  const tracePath = join(tempDir, 'docker-trace.log');
  const previousId = 'p'.repeat(64);
  const candidateId = 'c'.repeat(64);
  const transactionId = 'f'.repeat(64);

  mkdirSync(join(appDir, 'config'), { recursive: true });
  mkdirSync(join(appDir, 'docker'), { recursive: true });
  mkdirSync(join(appDir, 'scripts'), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(projectionPath, candidateProjection(), 'utf8');
  writeFileSync(persistedProjectionPath, persistedProjection, 'utf8');
  writeFileSync(
    envPath,
    `${previousProjection()}SECRET=preserved\nARBITRARY_OLD_VALUE=not-candidate\n`,
    'utf8'
  );
  writeExecutable(join(appDir, 'scripts/sync-billing-env.sh'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(
    join(appDir, 'scripts/validate-runtime-config-docker.sh'),
    '#!/usr/bin/env bash\nexit 0\n'
  );
  writeExecutable(
    join(binDir, 'docker'),
    [
      '#!/usr/bin/env bash',
      'case "${1:-}:${2:-}" in',
      '  compose:pull|compose:down)',
      '    printf "docker %s %s phase=%s\\n" "${1:-}" "${2:-}" "${DEPLOYMENT_PHASE:-unset}" >> "$TRACE_FILE"',
      '    ;;',
      '  compose:up)',
      '    printf "compose-up phase=%s\\n" "${DEPLOYMENT_PHASE:-unset}" >> "$TRACE_FILE"',
      '    cp "$APP_DIR/config/.env" "$GATEWAY_ENV_FILE"',
      '    cp "$APP_DIR/config/.env" "$API_ENV_FILE"',
      '    ;;',
      '  rm:*) ;;',
      '  login:*|logout:*) ;;',
      '  *) ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );

  const forwardScript = [
    'set -Eeuo pipefail',
    'source "$1"',
    'source "$2"',
    'source "$3"',
    'source "$4"',
    'source "$5"',
    'projection_path="$6"',
    'state_dir="$7"',
    'app_dir="$8"',
    'export APP_DIR="$app_dir"',
    'export STATE_DIR="$state_dir"',
    'export DEPLOYMENT_STATE_DIR="$state_dir"',
    'export DEPLOYMENT_STATE_RELEASES_DIR="$state_dir/releases"',
    'export DEPLOYMENT_STATE_PENDING_FILE="$state_dir/pending-images.env"',
    'export DEPLOYMENT_TRANSACTION_FILE="$state_dir/deployment-phase.env"',
    'export DEPLOYMENT_TRANSACTION_HISTORY_FILE="$state_dir/deployment-history.log"',
    'export PROJECTION_SOURCE="$projection_path"',
    'set -a',
    '. "$projection_path"',
    'set +a',
    'export TARGET_SHA="$APP_SHA"',
    'export CANDIDATE_SHA="$APP_SHA"',
    'mkdir -p "$state_dir"',
    'RELEASE_BUNDLE_FILE="$state_dir/bundle.json"',
    'OPENPATH_CONTRACT_FILE="$state_dir/contract.json"',
    'touch "$RELEASE_BUNDLE_FILE" "$OPENPATH_CONTRACT_FILE"',
    'export RELEASE_BUNDLE_FILE OPENPATH_CONTRACT_FILE',
    'configure_deploy_container_platform() { :; }',
    'verify_deploy_container_platform() { :; }',
    'login_production_registry() { :; }',
    'prepare_openpath_firefox_assets_from_image() { :; }',
    'activate_openpath_firefox_assets_generation() { :; }',
    'deployment_state_persist_v2_release() {',
    '  mkdir -p "$DEPLOYMENT_STATE_RELEASES_DIR/$3"',
    '  cp "$PERSISTED_PROJECTION" "$DEPLOYMENT_STATE_RELEASES_DIR/$3/runtime.env"',
    '}',
    'release_execution_mark_stage() { :; }',
    'capture_production_deploy_failure() {',
    '  local failed_status="$?"',
    '  trap - ERR',
    '  deployment_transaction_mark_failure "${FAILURE_POINT:-runtime-projection}" "${FAILURE_CATEGORY:-state-write}" "${FAILURE_MESSAGE:-runtime projection failed}" "${DEPLOYMENT_STAGE:-SWITCH}" || true',
    '  return "$failed_status"',
    '}',
    'trap capture_production_deploy_failure ERR',
    'plan_production_runtime_deploy_impl',
    'deployment_transaction_init "$DEPLOYMENT_TRANSACTION_FILE" "$9" "${10}" "${11}"',
    'production_runtime_adapter_prepare',
    ...(prepareOnly ? ['exit 0'] : []),
    'deployment_transaction_transition SWITCHING SWITCH',
    'production_runtime_activate_prepared_files',
    'production_runtime_adapter_switch',
    'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
  ].join('\n');

  const result = spawnSync(
    'bash',
    [
      '-c',
      forwardScript,
      'runtime-forward',
      commonHelper,
      releaseStateHelper,
      releaseRuntimeHelper,
      transactionHelper,
      productionRuntimeHelper,
      projectionPath,
      stateDir,
      appDir,
      previousId,
      candidateId,
      transactionId,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        API_ENV_FILE: apiEnvPath,
        APP_DIR: appDir,
        GATEWAY_ENV_FILE: gatewayEnvPath,
        PATH: `${binDir}:/usr/bin:/bin`,
        PERSISTED_PROJECTION: persistedProjectionPath,
        TRACE_FILE: tracePath,
      },
      encoding: 'utf8',
    }
  );

  return {
    tempDir,
    result,
    envPath,
    gatewayEnvPath,
    apiEnvPath,
    tracePath,
    stateFile: join(stateDir, 'deployment-phase.env'),
    historyFile: join(stateDir, 'deployment-history.log'),
    previousId,
    candidateId,
    transactionId,
  };
}

test('prepare leaves the active configuration untouched', () => {
  const fixture = runForwardProjectionFixture(candidateProjection(), true);
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assertProjectionInEnv(
      readFileSync(fixture.envPath, 'utf8'),
      previousProjection(),
      'active P config'
    );
    assert.match(readFileSync(fixture.stateFile, 'utf8'), /^MUTATION_BOUNDARY_REACHED=0$/mu);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('forward prepares C before the boundary and both recreated services receive C', () => {
  const fixture = runForwardProjectionFixture(candidateProjection());

  try {
    const output = `${fixture.result.stdout}\n${fixture.result.stderr}`;
    assert.equal(fixture.result.status, 0, output);
    const trace = readFileSync(fixture.tracePath, 'utf8');
    assert.match(trace, /compose-up phase=SWITCHING/u);
    assertProjectionInEnv(
      readFileSync(fixture.envPath, 'utf8'),
      candidateProjection(),
      'config/.env'
    );
    assertProjectionInEnv(
      readFileSync(fixture.gatewayEnvPath, 'utf8'),
      candidateProjection(),
      'gateway runtime'
    );
    assertProjectionInEnv(
      readFileSync(fixture.apiEnvPath, 'utf8'),
      candidateProjection(),
      'API runtime'
    );
    assert.match(readFileSync(fixture.envPath, 'utf8'), /^SECRET=preserved$/mu);
    assert.match(readFileSync(fixture.envPath, 'utf8'), /^ARBITRARY_OLD_VALUE=not-candidate$/mu);

    const marker = readFileSync(fixture.stateFile, 'utf8');
    assert.match(marker, /^DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED$/mu);
    assert.match(marker, /^MUTATION_BOUNDARY_REACHED=1$/mu);
    assert.match(marker, new RegExp(`DEPLOYMENT_TRANSACTION_ID=${fixture.transactionId}`, 'u'));
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('invalid candidate projection fails before the boundary and preserves P', () => {
  const malformedProjection = candidateProjection()
    .split('\n')
    .filter((line) => !line.startsWith('CLASSROOMPATH_GATEWAY_IMAGE='))
    .join('\n');
  const fixture = runForwardProjectionFixture(malformedProjection);

  try {
    const output = `${fixture.result.stdout}\n${fixture.result.stderr}`;
    assert.equal(fixture.result.status, 1, output);
    const failedMarker = readFileSync(fixture.stateFile, 'utf8');
    assert.match(failedMarker, /^DEPLOYMENT_PHASE=FAILED$/mu);
    assert.match(failedMarker, /^MUTATION_BOUNDARY_REACHED=0$/mu);
    assert.match(failedMarker, new RegExp(`CURRENT_RELEASE_ID=${fixture.previousId}`, 'u'));
    assert.doesNotMatch(readFileSync(fixture.tracePath, 'utf8'), /compose-up/u);

    assertHistory(fixture.historyFile, ['PREPARED', 'FAILED'], fixture.transactionId);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

function runLiveReadinessFixture(liveProjection: string) {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-live-runtime-attestation-'));
  const stateDir = join(tempDir, 'release-state');
  const releasesDir = join(stateDir, 'releases');
  const binDir = join(tempDir, 'bin');
  const projectionPath = join(releasesDir, `${'c'.repeat(64)}/runtime.env`);
  const liveEnvPath = join(tempDir, 'live.env');
  const stateFile = join(stateDir, 'deployment-phase.env');
  const historyFile = join(stateDir, 'deployment-history.log');
  const previousId = 'p'.repeat(64);
  const candidateId = 'c'.repeat(64);
  const transactionId = 'a'.repeat(64);

  mkdirSync(dirname(projectionPath), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(projectionPath, candidateProjection(), 'utf8');
  writeFileSync(liveEnvPath, liveProjection, 'utf8');
  writeExecutable(join(binDir, 'timeout'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(join(binDir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(
    join(binDir, 'docker'),
    [
      '#!/usr/bin/env bash',
      'case "${1:-}:${2:-}" in',
      '  inspect:*) cat "$LIVE_ENV_FILE" ;;',
      '  logs:*) exit 0 ;;',
      '  compose:ps) printf "%s\\n" healthy ;;',
      '  *) ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );
  writeExecutable(
    join(binDir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'url="${!#}"',
      'case "$url" in',
      '  */cp/health) printf 200; exit 0 ;;',
      '  */cp/ready) printf "%s\\n200" "{\\"ready\\":true}"; exit 0 ;;',
      '  *) exit 22 ;;',
      'esac',
      '',
    ].join('\n')
  );

  const forwardScript = [
    'set -Eeuo pipefail',
    'source "$1"',
    'source "$2"',
    'source "$3"',
    'source "$4"',
    'source "$5"',
    'state_dir="$6"',
    'live_env="$7"',
    'export STATE_DIR="$state_dir"',
    'export DEPLOYMENT_STATE_RELEASES_DIR="$state_dir/releases"',
    'export DEPLOYMENT_TRANSACTION_FILE="$state_dir/deployment-phase.env"',
    'export DEPLOYMENT_TRANSACTION_HISTORY_FILE="$state_dir/deployment-history.log"',
    'export RELEASE_ID="$8"',
    'export CANDIDATE_RELEASE_ID="$8"',
    'export CURRENT_RELEASE_ID="$9"',
    'export PREVIOUS_RELEASE_ID="$9"',
    'export DB_MIGRATED=0',
    'export LIVE_ENV_FILE="$live_env"',
    'rollback_readiness_json_is_ready() { [ "${1:-}" = "{\\"ready\\":true}" ]; }',
    'release_execution_mark_stage() { :; }',
    'deployment_state_activate_v2_release() { :; }',
    'deployment_state_publish_pending_release() { :; }',
    'deployment_transaction_init "$DEPLOYMENT_TRANSACTION_FILE" "$9" "$8" "${10}"',
    'deployment_transaction_transition SWITCHING SWITCH',
    'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
    'capture_production_deploy_failure() {',
    '  local failed_status="$?"',
    '  trap - ERR',
    '  deployment_transaction_mark_failure "${FAILURE_POINT:-runtime-attestation}" "${FAILURE_CATEGORY:-runtime-attestation}" "${FAILURE_MESSAGE:-live runtime mismatch}" VERIFY || true',
    '  return "$failed_status"',
    '}',
    'trap capture_production_deploy_failure ERR',
    'run_remote_deploy_phases() {',
    '  local phase_name=""',
    '  for phase_name in "$@"; do "$phase_name"; done',
    '}',
    'production_runtime_ensure_shared_executor',
    'deploy_runtime_wait_for_health_and_readiness',
    'validate_production_runtime_projection_live',
    'deployment_transaction_transition VERIFIED VERIFY',
    'deployment_transaction_transition COMMITTED COMMIT',
  ].join('\n');

  const result = spawnSync(
    'bash',
    [
      '-c',
      forwardScript,
      'live-forward',
      commonHelper,
      releaseStateHelper,
      transactionHelper,
      releaseRuntimeHelper,
      productionRuntimeHelper,
      stateDir,
      liveEnvPath,
      candidateId,
      previousId,
      transactionId,
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, LIVE_ENV_FILE: liveEnvPath, PATH: `${binDir}:/usr/bin:/bin` },
      encoding: 'utf8',
    }
  );

  return { tempDir, result, stateFile, historyFile, previousId, candidateId, transactionId };
}

test('live projection mismatch blocks VERIFIED and recovers to P', () => {
  const fixture = runLiveReadinessFixture(previousProjection());

  try {
    const output = `${fixture.result.stdout}\n${fixture.result.stderr}`;
    assert.equal(fixture.result.status, 1, output);
    const failedMarker = readFileSync(fixture.stateFile, 'utf8');
    assert.match(failedMarker, /^DEPLOYMENT_PHASE=FAILED$/mu);
    assert.match(failedMarker, new RegExp(`CURRENT_RELEASE_ID=${fixture.previousId}`, 'u'));
    assert.doesNotMatch(readFileSync(fixture.historyFile, 'utf8'), /DEPLOYMENT_PHASE=VERIFIED/u);
    assert.doesNotMatch(readFileSync(fixture.historyFile, 'utf8'), /DEPLOYMENT_PHASE=COMMITTED/u);

    recoverTransaction(fixture.stateFile, fixture.historyFile);
    const rolledBackMarker = readFileSync(fixture.stateFile, 'utf8');
    assert.match(rolledBackMarker, /^DEPLOYMENT_PHASE=ROLLED_BACK$/mu);
    assert.match(rolledBackMarker, new RegExp(`CURRENT_RELEASE_ID=${fixture.previousId}`, 'u'));
    assertHistory(
      fixture.historyFile,
      ['PREPARED', 'SWITCHING', 'ACTIVATED_UNVERIFIED', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK'],
      fixture.transactionId
    );
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('matching live projection allows the normal VERIFIED to COMMITTED path', () => {
  const fixture = runLiveReadinessFixture(candidateProjection());

  try {
    const output = `${fixture.result.stdout}\n${fixture.result.stderr}`;
    assert.equal(fixture.result.status, 0, output);
    const marker = readFileSync(fixture.stateFile, 'utf8');
    assert.match(marker, /^DEPLOYMENT_PHASE=COMMITTED$/mu);
    assert.match(marker, new RegExp(`CURRENT_RELEASE_ID=${fixture.candidateId}`, 'u'));
    assertHistory(
      fixture.historyFile,
      ['PREPARED', 'SWITCHING', 'ACTIVATED_UNVERIFIED', 'VERIFIED', 'COMMITTED'],
      fixture.transactionId
    );
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('candidate preparation precedes the shared executor mutation boundary', () => {
  const runtimeSource = readFileSync(productionRuntimeHelper, 'utf8');
  assert.ok(
    runtimeSource.indexOf('deployment_state_persist_v2_release') <
      runtimeSource.indexOf('  apply_release_runtime_projection_to_env_file')
  );
  const executor = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh'),
    'utf8'
  );
  const prepare = executor.indexOf('if ! "$prepare_fn"');
  const boundary = executor.indexOf(
    'deployment_transaction_transition "${DEPLOYMENT_PHASE_SWITCHING:-SWITCHING}" SWITCH'
  );
  const migrate = executor.indexOf('if ! "$migrate_fn"');
  assert.ok(prepare >= 0 && boundary > prepare && migrate > boundary);
});
