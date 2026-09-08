import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { extractShellFunction } from './helpers/ops-contracts.ts';

const projectRoot = resolve(import.meta.dirname, '..');
const stagingRemoteScript = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
const transactionHelper = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');
const runtimeExecutorHelper = resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh');
const releaseStateHelper = resolve(projectRoot, 'scripts/lib/release-state.sh');
const releaseRuntimeHelper = resolve(projectRoot, 'scripts/lib/release-runtime.sh');
const ledgerHelper = resolve(projectRoot, 'scripts/lib/deployment-ledger.sh');

const candidateSha = 'c'.repeat(40);
const previousSha = 'b'.repeat(40);
const candidateReleaseId = 'c'.repeat(64);
const previousReleaseId = 'a'.repeat(64);
const digest = 'd'.repeat(64);

const stagingFunctions = [
  'resolve_pulled_digest',
  'deploy_with_release_candidates',
  'run_staging_database_migrations',
  'apply_staging_release_candidate_runtime_projection',
  'staging_runtime_adapter_prepare',
  'staging_runtime_adapter_migrate',
  'compose_up_force_recreate_no_build',
  'staging_runtime_adapter_switch',
  'staging_runtime_adapter_validate_live',
  'staging_runtime_adapter_fault_barrier',
  'deploy_runtime_adapter_recover',
]
  .map((name) => extractShellFunction(readFileSync(stagingRemoteScript, 'utf8'), name))
  .join('\n\n');

function createHarness(
  failureMode:
    | 'none'
    | 'prepare'
    | 'prepare-digest'
    | 'migrate'
    | 'projection'
    | 'stage'
    | 'switch'
    | 'restore-unavailable'
) {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-staging-runtime-projection-'));
  const functionsPath = join(tempDir, 'staging-functions.sh');
  const tracePath = join(tempDir, 'trace.log');
  const stateDir = join(tempDir, 'state');
  const statePath = join(stateDir, 'deployment-phase.env');
  const historyPath = join(stateDir, 'deployment-phase-history.env');
  const appDir = join(tempDir, 'app');
  const configPath = join(appDir, 'config', '.env');
  mkdirSync(join(appDir, 'config'), { recursive: true });
  writeFileSync(functionsPath, stagingFunctions, 'utf8');
  writeFileSync(configPath, 'SENTINEL=previous\nOPENPATH_VERSION=previous\n', 'utf8');

  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
source "$3"
source "$4"
source "$5"
source "$6"

TRACE_FILE="$7"
CONFIG_FILE="$8"
STATE_DIR="$9"
FAILURE_MODE="\${10}"
STATE_FILE="\${11}"
HISTORY_FILE="\${12}"
APP_DIR="\${17}"
PREVIOUS_APP_SHA="\${13}"
PREVIOUS_RELEASE_ID="\${14}"
CANDIDATE_RELEASE_ID="\${15}"
TRANSACTION_ID="\${16}"
DEPLOYMENT_STATE_RELEASES_DIR="$STATE_DIR/releases"
DEPLOYMENT_TRANSACTION_FILE="$STATE_FILE"
DEPLOYMENT_TRANSACTION_HISTORY_FILE="$HISTORY_FILE"
DEPLOYMENT_LEDGER_FILE="$STATE_DIR/deployment-ledger.jsonl"
DEPLOYMENT_ENVIRONMENT=staging
STAGING_USE_RELEASE_CANDIDATE=1
STAGING_IMAGE_MODE=release-candidate
STAGING_RELEASE_SHA=${candidateSha}
STAGING_RELEASE_RUN_ID=12345
RC_RUN_ID=12345
CANDIDATE_SHA=${candidateSha}
RELEASE_ID=${candidateReleaseId}
APP_SHA=${candidateSha}
OPENPATH_SHA=${candidateSha}
OPENPATH_CONTRACT_SHA256=${digest}
IMAGE_SOURCE=release-candidate
OPENPATH_VERSION=candidate-version
OPENPATH_LINUX_AGENT_VERSION=candidate-agent
OPENPATH_LINUX_AGENT_APT_SUITE=stable
OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=candidate-template
OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=candidate-commit
OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=candidate-tag
OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=${digest}
CLASSROOMPATH_GATEWAY_IMAGE="gateway@sha256:${digest}"
CLASSROOMPATH_MIGRATIONS_IMAGE="migrations@sha256:${digest}"
OPENPATH_FIREFOX_ASSETS_IMAGE="firefox-assets@sha256:${digest}"
OPENPATH_API_IMAGE="api@sha256:${digest}"
CLASSROOMPATH_SPA_IMAGE="spa@sha256:${digest}"
CLASSROOMPATH_VERIFIER_IMAGE="verifier@sha256:${digest}"
RESOLVED_GATEWAY_IMAGE="$CLASSROOMPATH_GATEWAY_IMAGE"
RESOLVED_MIGRATIONS_IMAGE="$CLASSROOMPATH_MIGRATIONS_IMAGE"
RESOLVED_OPENPATH_FIREFOX_ASSETS_IMAGE="$OPENPATH_FIREFOX_ASSETS_IMAGE"
RESOLVED_OPENPATH_API_IMAGE="$OPENPATH_API_IMAGE"
RESOLVED_SPA_IMAGE="$CLASSROOMPATH_SPA_IMAGE"
RESOLVED_VERIFIER_IMAGE="$CLASSROOMPATH_VERIFIER_IMAGE"
mkdir -p "$APP_DIR/docker" "$STATE_DIR"

trace() { printf '%s\n' "$*" >> "$TRACE_FILE"; }
trace "args tx=$TRANSACTION_ID prev=$PREVIOUS_RELEASE_ID candidate=$CANDIDATE_RELEASE_ID"
log_info() { :; }
log_warn() { trace "warn:$*"; }
log_error() { trace "error:$*"; }

upsert_env_file_var() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  trace "projection:$key"
  if [ "$FAILURE_MODE" = projection ] && [ "$key" = RELEASE_ID ]; then
    return 1
  fi
  awk -F= -v key="$key" '$1 != key' "$env_file" 2>/dev/null >"$env_file.tmp" || :
  printf '%s=%s\n' "$key" "$value" >>"$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
}

ensure_staging_release_candidate_runtime_env() { trace ensure; return 0; }
login_staging_registry() { trace login; return 0; }
prepare_openpath_firefox_assets_from_image() { trace "assets:$3"; return 0; }
activate_openpath_firefox_assets_generation() { trace assets-activate; return 0; }

write_release_state() {
  if [ "$FAILURE_MODE" = prepare ]; then
    trace persist-failed
    return 1
  fi
  if grep -q '^OPENPATH_VERSION=candidate-version$' "$CONFIG_FILE"; then
    trace preboundary-mutated
    return 1
  fi
  trace preboundary-clean
  trace persist
  mkdir -p "$DEPLOYMENT_STATE_RELEASES_DIR/$RELEASE_ID"
  printf '%s\n' \
    "RELEASE_ID=$RELEASE_ID" \
    "RC_RUN_ID=$RC_RUN_ID" \
    "APP_SHA=$APP_SHA" \
    "OPENPATH_SHA=$OPENPATH_SHA" \
    "OPENPATH_CONTRACT_SHA256=$OPENPATH_CONTRACT_SHA256" \
    "IMAGE_SOURCE=$IMAGE_SOURCE" \
    "CLASSROOMPATH_GATEWAY_IMAGE=$RESOLVED_GATEWAY_IMAGE" \
    "CLASSROOMPATH_MIGRATIONS_IMAGE=$RESOLVED_MIGRATIONS_IMAGE" \
    "OPENPATH_FIREFOX_ASSETS_IMAGE=$RESOLVED_OPENPATH_FIREFOX_ASSETS_IMAGE" \
    "OPENPATH_API_IMAGE=$RESOLVED_OPENPATH_API_IMAGE" \
    "OPENPATH_VERSION=$OPENPATH_VERSION" \
    "OPENPATH_LINUX_AGENT_VERSION=$OPENPATH_LINUX_AGENT_VERSION" \
    "OPENPATH_LINUX_AGENT_APT_SUITE=$OPENPATH_LINUX_AGENT_APT_SUITE" \
    "CLASSROOMPATH_SPA_IMAGE=$RESOLVED_SPA_IMAGE" \
    "CLASSROOMPATH_VERIFIER_IMAGE=$RESOLVED_VERIFIER_IMAGE" \
    "OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION" \
    "OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT" \
    "OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG" \
    "OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256" \
    >"$DEPLOYMENT_STATE_RELEASES_DIR/$RELEASE_ID/runtime.env"
}

release_execution_mark_stage() {
  trace "stage:$1"
  if [ "$FAILURE_MODE" = stage ] && [ "$1" = migrations ]; then
    return 1
  fi
  return 0
}

bash() {
  if [[ "$*" == *run-migrations-docker.sh* ]]; then
    if grep -q '^OPENPATH_VERSION=candidate-version$' "$CONFIG_FILE"; then
      trace migration-config:candidate
    else
      trace migration-config:previous
      return 1
    fi
    trace migration
    [ "$FAILURE_MODE" != migrate ]
    return $?
  fi
  command bash "$@"
}

docker() {
  case "\${1:-}:\${2:-}" in
    image:inspect)
      trace "inspect:\${3:-}"
      if [ "$FAILURE_MODE" = prepare-digest ]; then
        return 1
      fi
      printf 'registry/example@sha256:${digest}\n'
      ;;
    pull:*)
      trace "docker-pull:$*"
      ;;
    compose:*)
      trace "compose:\${*:2}"
      if [ "$FAILURE_MODE" = switch ] && [ "\${2:-}" = up ]; then
        return 1
      fi
      ;;
    rm:*)
      trace "docker-rm:$*"
      ;;
    *)
      trace "docker:$*"
      ;;
  esac
  return 0
}

deploy_runtime_wait_for_health_and_readiness() { trace health; return 0; }
staging_runtime_adapter_validate_live() {
  trace validate
  [ "$FAILURE_MODE" != restore-unavailable ]
}
staging_runtime_adapter_fault_barrier() { trace fault; return 0; }
deployment_state_activate_v2_release() { trace activate; return 0; }
deployment_state_publish_pending_release() { trace publish; return 0; }

restore_previous_release_state() {
  trace restore
  if [ "$FAILURE_MODE" = restore-unavailable ]; then
    ROLLBACK_RESULT=unavailable
    trace rollback-unavailable
    return 1
  fi
  awk -F= '$1 != "OPENPATH_VERSION"' "$CONFIG_FILE" >"$CONFIG_FILE.tmp"
  printf 'OPENPATH_VERSION=previous\n' >>"$CONFIG_FILE.tmp"
  mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
  RELEASE_ID=${previousReleaseId}
  RC_RUN_ID=54321
  APP_SHA=${previousSha}
  OPENPATH_SHA=${previousSha}
  OPENPATH_CONTRACT_SHA256="p${digest.slice(1)}"
  IMAGE_SOURCE=release-candidate
  CLASSROOMPATH_GATEWAY_IMAGE="previous-gateway@sha256:${digest}"
  CLASSROOMPATH_MIGRATIONS_IMAGE="previous-migrations@sha256:${digest}"
  OPENPATH_FIREFOX_ASSETS_IMAGE="previous-firefox-assets@sha256:${digest}"
  OPENPATH_API_IMAGE="previous-api@sha256:${digest}"
  CLASSROOMPATH_SPA_IMAGE="previous-spa@sha256:${digest}"
  CLASSROOMPATH_VERIFIER_IMAGE="previous-verifier@sha256:${digest}"
  export RELEASE_ID RC_RUN_ID APP_SHA OPENPATH_SHA OPENPATH_CONTRACT_SHA256 IMAGE_SOURCE
  export CLASSROOMPATH_GATEWAY_IMAGE CLASSROOMPATH_MIGRATIONS_IMAGE
  export OPENPATH_FIREFOX_ASSETS_IMAGE OPENPATH_API_IMAGE
  export CLASSROOMPATH_SPA_IMAGE CLASSROOMPATH_VERIFIER_IMAGE
  return 0
}

deployment_transaction_init "$STATE_FILE" "$PREVIOUS_RELEASE_ID" "$CANDIDATE_RELEASE_ID" "$TRANSACTION_ID"
export PREVIOUS_APP_SHA
status=0
deploy_runtime_execute staging_runtime_adapter_prepare staging_runtime_adapter_migrate staging_runtime_adapter_switch staging_runtime_adapter_validate_live staging_runtime_adapter_fault_barrier || status=$?
printf 'status=%s\n' "$status" >> "$TRACE_FILE"
exit "$status"
`;

  const result = spawnSync(
    'bash',
    [
      '-c',
      script,
      'staging-runtime-projection',
      transactionHelper,
      runtimeExecutorHelper,
      releaseStateHelper,
      releaseRuntimeHelper,
      ledgerHelper,
      functionsPath,
      tracePath,
      configPath,
      stateDir,
      failureMode,
      statePath,
      historyPath,
      previousSha,
      previousReleaseId,
      candidateReleaseId,
      'e'.repeat(64),
      appDir,
    ],
    { cwd: projectRoot, encoding: 'utf8' }
  );

  if (result.status !== 0 && process.env.DEBUG_STAGING_RUNTIME_PROJECTION === '1') {
    console.error('HARNESS', failureMode, result.status, result.stdout, result.stderr);
    console.error('TRACE', readFileSync(tracePath, 'utf8'));
  }

  return {
    tempDir,
    result,
    tracePath,
    configPath,
    statePath,
    historyPath,
    ledgerPath: join(stateDir, 'deployment-ledger.jsonl'),
  };
}

function lines(path: string): string[] {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

function ledgerRecords(path: string): Array<Record<string, unknown>> {
  return lines(path).map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('staging RC runtime persists before the boundary and projects once before migration/switch/commit', () => {
  const fixture = createHarness('none');
  try {
    assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    const index = (entry: string) => trace.indexOf(entry);
    assert.ok(index('assets:prepare-only') >= 0);
    assert.ok(index('assets:prepare-only') < index('preboundary-clean'));
    assert.ok(index('persist') >= 0);
    assert.ok(index('preboundary-clean') > index('assets:prepare-only'));
    assert.ok(index('projection:RELEASE_ID') > index('persist'));
    assert.ok(index('projection:RELEASE_ID') < index('migration-config:candidate'));
    assert.ok(index('migration-config:candidate') < index('migration'));
    assert.equal(trace.filter((entry) => entry === 'projection:RELEASE_ID').length, 1);
    assert.ok(index('assets-activate') > index('migration'));
    assert.ok(index('compose:down --remove-orphans') > index('projection:RELEASE_ID'));
    assert.ok(index('compose:down --remove-orphans') > index('assets-activate'));
    assert.ok(
      index('compose:up -d --force-recreate --no-build') > index('compose:down --remove-orphans')
    );
    const ledger = ledgerRecords(fixture.ledgerPath);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.result, 'COMMITTED');
    assert.equal(ledger[0]?.candidateSha, candidateSha);
    assert.equal(ledger[0]?.current, candidateSha);
    assert.equal(lines(fixture.configPath).includes('OPENPATH_VERSION=candidate-version'), true);
    assert.equal(lines(fixture.configPath).includes('SENTINEL=previous'), true);
    const history = lines(fixture.historyPath).map(
      (line) => line.match(/^DEPLOYMENT_PHASE=([^ ]+)/)?.[1]
    );
    assert.deepEqual(history, [
      'PREPARED',
      'SWITCHING',
      'ACTIVATED_UNVERIFIED',
      'VERIFIED',
      'COMMITTED',
    ]);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('prepare failure leaves the candidate unprojected and does not migrate, switch, or commit', () => {
  const fixture = createHarness('prepare');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.equal(trace.includes('migration'), false);
    assert.equal(
      trace.some((entry) => entry.startsWith('projection:')),
      false
    );
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:down')),
      false
    );
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:up')),
      false
    );
    assert.equal(
      ledgerRecords(fixture.ledgerPath).some((record) => record.result === 'COMMITTED'),
      false
    );
    assert.equal(lines(fixture.configPath).includes('OPENPATH_VERSION=candidate-version'), false);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('candidate projection precedes migration and migration failure stops switch/commit', () => {
  const fixture = createHarness('migrate');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.ok(trace.includes('persist'));
    assert.ok(trace.includes('migration'));
    assert.ok(trace.includes('projection:RELEASE_ID'));
    assert.ok(trace.includes('migration-config:candidate'));
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:down')),
      false
    );
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:up')),
      false
    );
    assert.equal(
      ledgerRecords(fixture.ledgerPath).some((record) => record.result === 'COMMITTED'),
      false
    );
    assert.equal(lines(fixture.configPath).includes('OPENPATH_VERSION=candidate-version'), false);
    const ledger = ledgerRecords(fixture.ledgerPath).at(-1);
    assert.equal(ledger?.result, 'ROLLED_BACK');
    assert.equal(ledger?.candidateSha, candidateSha);
    assert.equal(ledger?.releaseId, candidateReleaseId);
    assert.equal(ledger?.current, previousSha);
    assert.equal(ledger?.rcRunId, '12345');
    assert.deepEqual(ledger?.imageDigests, {
      gateway: `sha256:${digest}`,
      migrations: `sha256:${digest}`,
      openpathFirefoxAssets: `sha256:${digest}`,
      openpathApi: `sha256:${digest}`,
      spa: `sha256:${digest}`,
      verifier: `sha256:${digest}`,
    });
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('projection failure propagates before compose switch and commit', () => {
  const fixture = createHarness('projection');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.ok(trace.includes('persist'));
    assert.equal(trace.includes('migration'), false);
    assert.ok(trace.includes('projection:RELEASE_ID'));
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:down')),
      false
    );
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:up')),
      false
    );
    assert.equal(
      ledgerRecords(fixture.ledgerPath).some((record) => record.result === 'COMMITTED'),
      false
    );
    const ledger = ledgerRecords(fixture.ledgerPath).at(-1);
    assert.equal(ledger?.result, 'ROLLED_BACK');
    assert.equal(ledger?.candidateSha, candidateSha);
    assert.equal(ledger?.releaseId, candidateReleaseId);
    assert.equal(ledger?.current, previousSha);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('staging migration stage failure is propagated before the migration side effect', () => {
  const fixture = createHarness('stage');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.ok(trace.includes('stage:migrations'));
    assert.equal(trace.includes('projection:RELEASE_ID'), false);
    assert.equal(trace.includes('migration'), false);
    assert.equal(
      trace.some((entry) => entry.startsWith('projection:')),
      false
    );
    assert.equal(
      trace.some((entry) => entry.startsWith('compose:down')),
      false
    );
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('staging switch failure is propagated after projection and boundary', () => {
  const fixture = createHarness('switch');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.ok(trace.includes('migration'));
    assert.equal(trace.filter((entry) => entry === 'projection:RELEASE_ID').length, 1);
    assert.ok(trace.includes('compose:down --remove-orphans'));
    assert.ok(trace.includes('compose:up -d --force-recreate --no-build'));
    assert.equal(
      ledgerRecords(fixture.ledgerPath).some((record) => record.result === 'COMMITTED'),
      false
    );
    const ledger = ledgerRecords(fixture.ledgerPath).at(-1);
    assert.equal(ledger?.result, 'ROLLED_BACK');
    assert.equal(ledger?.candidateSha, candidateSha);
    assert.equal(ledger?.releaseId, candidateReleaseId);
    assert.equal(ledger?.current, previousSha);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('release-candidate digest failure is propagated before persistence or migration', () => {
  const fixture = createHarness('prepare-digest');
  try {
    assert.equal(fixture.result.status, 1, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const trace = lines(fixture.tracePath);
    assert.ok(trace.some((entry) => entry.startsWith('inspect:')));
    assert.equal(trace.includes('persist'), false);
    assert.equal(trace.includes('migration'), false);
    assert.equal(
      trace.some((entry) => entry.startsWith('projection:')),
      false
    );
    assert.equal(
      trace.some((entry) => entry === 'compose:down --remove-orphans'),
      false
    );
    assert.equal(
      trace.some((entry) => entry === 'compose:up -d --force-recreate --no-build'),
      false
    );
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test('recovery adapter preserves candidate identity while retaining an unavailable rollback result', () => {
  const functionPath = join(
    mkdtempSync(join(tmpdir(), 'classroompath-staging-recovery-')),
    'fn.sh'
  );
  writeFileSync(
    functionPath,
    extractShellFunction(
      readFileSync(stagingRemoteScript, 'utf8'),
      'deploy_runtime_adapter_recover'
    ),
    'utf8'
  );
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        String.raw`set -u
source "$1"
RELEASE_ID=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
RC_RUN_ID=12345
OPENPATH_SHA=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CLASSROOMPATH_GATEWAY_IMAGE=candidate-gateway@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
ROLLBACK_RESULT=running
restore_previous_release_state() {
  RELEASE_ID=pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp
  RC_RUN_ID=54321
  OPENPATH_SHA=pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp
  CLASSROOMPATH_GATEWAY_IMAGE=previous-gateway@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
  ROLLBACK_RESULT=unavailable
  return 1
}
if deploy_runtime_adapter_recover; then status=0; else status=$?; fi
printf 'status=%s release=%s rc=%s openpath=%s gateway=%s rollback=%s\n' "$status" "$RELEASE_ID" "$RC_RUN_ID" "$OPENPATH_SHA" "$CLASSROOMPATH_GATEWAY_IMAGE" "$ROLLBACK_RESULT"
`,
        'staging-recovery',
        functionPath,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(
      result.stdout,
      /status=1 release=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc rc=12345 openpath=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc gateway=candidate-gateway@sha256:.* rollback=unavailable/u
    );
    assert.match(result.stdout, /gateway=candidate-gateway@sha256:/u);
  } finally {
    rmSync(resolve(functionPath, '..'), { recursive: true, force: true });
  }
});

test('source-build keeps its legacy build path outside the RC projection adapter', () => {
  const source = readFileSync(stagingRemoteScript, 'utf8');
  const sourceStart = source.indexOf('deploy_from_source()');
  const sourceEnd = source.indexOf('\nload_staging_release_manifest()', sourceStart);
  const sourceBuild = source.slice(sourceStart, sourceEnd);

  assert.match(sourceBuild, /docker compose build/u);
  assert.match(sourceBuild, /docker compose up -d --force-recreate/u);
  assert.doesNotMatch(sourceBuild, /apply_release_runtime_projection_to_env_file/u);
  assert.equal((source.match(/apply_release_runtime_projection_to_env_file/g) ?? []).length, 1);
});

test('pulled release images must resolve to an immutable digest', () => {
  const functionPath = join(mkdtempSync(join(tmpdir(), 'classroompath-staging-digest-')), 'fn.sh');
  writeFileSync(
    functionPath,
    extractShellFunction(readFileSync(stagingRemoteScript, 'utf8'), 'resolve_pulled_digest'),
    'utf8'
  );
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        String.raw`set -u
source "$1"
docker() { return 0; }
if resolve_pulled_digest ghcr.io/example/gateway:tag >/dev/null; then exit 0; else exit 1; fi
`,
        'staging-digest',
        functionPath,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(resolve(functionPath, '..'), { recursive: true, force: true });
  }
});
