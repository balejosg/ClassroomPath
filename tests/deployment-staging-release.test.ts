import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProjectWorkflow } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

describe('Deployment staging and promotion contracts', () => {
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingLocalReleaseHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-release.sh'
  );
  const stagingLocalVerifyHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-verify.sh'
  );
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const stagingHealthCheckScriptPath = resolve(projectRoot, 'scripts/check-staging-health.sh');
  const stagingReleaseGateScriptPath = resolve(projectRoot, 'scripts/run-staging-release-gate.sh');
  const stagingSmokeScriptPath = resolve(projectRoot, 'scripts/run-staging-smoke.sh');
  const stagingVerificationRunnerPath = resolve(projectRoot, 'scripts/run-staging-verification.sh');
  const stagingVerifyStateScriptPath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );
  const stagingGatesHelperPath = resolve(projectRoot, 'scripts/lib/staging-gates.sh');
  const releaseImagesScriptPath = resolve(projectRoot, 'scripts/release-images.mjs');
  const releasePlanScriptPath = resolve(projectRoot, 'scripts/lib/release-plan.mjs');
  const waitForReleaseCandidateScriptPath = resolve(
    projectRoot,
    'scripts/wait-for-release-candidate.mjs'
  );
  const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy.yml');
  const promoteCurrentStagingWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/promote-current-staging-candidate.yml'
  );
  const promoteCurrentStagingPreflightPath = resolve(
    projectRoot,
    'scripts/preflight-current-staging-promotion.sh'
  );
  const promotionReadyScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-promotion-ready.sh'
  );
  const productionHostReadinessScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-host-readiness.sh'
  );
  const productionTargetPreflightScriptPath = resolve(
    projectRoot,
    'scripts/preflight-production-promotion-target.sh'
  );
  const deployProductionContextHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-context.sh'
  );
  const deployProductionRuntimeHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-runtime.sh'
  );
  const stagingRollbackHelperPath = resolve(projectRoot, 'scripts/lib/staging-rollback.sh');
  const rollbackReadinessHelperPath = resolve(projectRoot, 'scripts/lib/rollback-readiness.sh');
  const productionRollbackScriptPath = resolve(
    projectRoot,
    'scripts/rollback-production-remote.sh'
  );

  function runRollbackReadinessHarness({
    healthHttpStatus = 200,
    readyHttpStatus = 200,
    healthCurlStatus = 0,
    readyCurlStatus = 0,
    readyResponse = '{"ready":true}',
  }: {
    healthHttpStatus?: number;
    readyHttpStatus?: number;
    healthCurlStatus?: number;
    readyCurlStatus?: number;
    readyResponse?: string;
  }) {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-rollback-readiness-'));

    try {
      return spawnSync(
        'bash',
        [
          '-c',
          String.raw`set -u
source "$1"
HEALTH_HTTP_STATUS="$2"
READY_HTTP_STATUS="$3"
HEALTH_CURL_STATUS="$4"
READY_CURL_STATUS="$5"
READY_RESPONSE="$6"
ROLLBACK_STATE=inactive
log_error() { :; }
sleep() { :; }
curl() {
  local output_file=""
  local url=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o)
        output_file="$2"
        shift 2
        ;;
      -w)
        shift 2
        ;;
      *)
        url="$1"
        shift
        ;;
    esac
  done
  if [[ "$url" == *"/cp/health"* ]]; then
    if [ "$HEALTH_CURL_STATUS" -ne 0 ]; then
      return "$HEALTH_CURL_STATUS"
    fi
    printf '%s' "$HEALTH_HTTP_STATUS"
    return 0
  fi
  if [[ "$url" == *"/cp/ready"* ]]; then
    if [ "$READY_CURL_STATUS" -ne 0 ]; then
      return "$READY_CURL_STATUS"
    fi
    printf '%s' "$READY_RESPONSE" >"$output_file"
    printf '%s' "$READY_HTTP_STATUS"
    return 0
  fi
  return 1
}
if rollback_wait_for_health_and_readiness http://localhost:3001 1 0; then
  ROLLBACK_STATE=active
fi
printf 'state=%s\n' "$ROLLBACK_STATE"
`,
          'rollback-readiness-test',
          rollbackReadinessHelperPath,
          String(healthHttpStatus),
          String(readyHttpStatus),
          String(healthCurlStatus),
          String(readyCurlStatus),
          readyResponse,
        ],
        { cwd: projectRoot, encoding: 'utf-8' }
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  function runRollbackHarness(mode: string) {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-staging-rollback-'));
    const previousStatePath = resolve(tempDir, 'state/previous-images.env');
    const imageSource = mode.startsWith('release-') ? 'release-candidate' : 'source-build';

    mkdirSync(resolve(tempDir, 'state'), { recursive: true });
    writeFileSync(
      previousStatePath,
      [
        'RELEASE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'RC_RUN_ID=123',
        'APP_SHA=previous-sha',
        'OPENPATH_SHA=cccccccccccccccccccccccccccccccccccccccc',
        'OPENPATH_CONTRACT_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        `IMAGE_SOURCE=${imageSource}`,
        'OPENPATH_FIREFOX_ASSETS_IMAGE=firefox-assets:previous',
        'OPENPATH_VERSION=4.1.0',
        'OPENPATH_LINUX_AGENT_VERSION=4.1.0',
        'OPENPATH_LINUX_AGENT_APT_SUITE=stable',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=template-commit',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=scripts-v4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'CLASSROOMPATH_GATEWAY_IMAGE=gateway:previous',
        'CLASSROOMPATH_MIGRATIONS_IMAGE=migrations:previous',
        'OPENPATH_API_IMAGE=openpath-api:previous',
        'CLASSROOMPATH_SPA_IMAGE=spa:previous',
        'CLASSROOMPATH_VERIFIER_IMAGE=verifier@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        '',
      ].join('\n')
    );

    try {
      return spawnSync(
        'bash',
        [
          '-c',
          String.raw`set -uo pipefail
source "$4"
source "$5"
source "$1"
APP_DIR="$2/app"
STATE_DIR="$2/state"
PREVIOUS_STATE_FILE="$2/state/previous-images.env"
CURRENT_STATE_FILE="$2/state/current-images.env"
DEPLOY_CONTEXT_FILE="$2/state/deploy-context.env"
CALLS_FILE="$2/docker-calls.log"
ROLLBACK_MODE="$3"
mkdir -p "$APP_DIR/docker" "$STATE_DIR"
ROLLBACK_RESULT=not_attempted
ROLLBACK_ATTEMPTED=0
STAGING_ROLLBACK_READINESS_ATTEMPTS=1
STAGING_ROLLBACK_READINESS_DELAY_SECONDS=0
write_deploy_context() { :; }
require_windows_offline_installer_runtime_pin() { return 0; }
upsert_env_file_var() { return 0; }
remove_env_file_var() { return 0; }
compose_up_force_recreate_no_build() { docker compose up -d --force-recreate --no-build; }
git() {
  printf 'git %s\n' "$*" >>"$CALLS_FILE"
  if [ "$ROLLBACK_MODE" = git ] && [ "$1" = checkout ]; then
    return 1
  fi
  return 0
}
docker() {
  printf 'docker %s\n' "$*" >>"$CALLS_FILE"
  if [ "$1" = compose ]; then
    case "$2" in
      pull) [ "$ROLLBACK_MODE" = release-pull ] && return 1 ;;
      build) [ "$ROLLBACK_MODE" = build ] && return 1 ;;
      up) [ "$ROLLBACK_MODE" = release-up ] || [ "$ROLLBACK_MODE" = up ] && return 1 ;;
    esac
  fi
  return 0
}
curl() {
  local output_file=""
  local url=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o)
        output_file="$2"
        shift 2
        ;;
      -w)
        shift 2
        ;;
      *)
        url="$1"
        shift
        ;;
    esac
  done
  if [[ "$url" == *"/cp/ready"* ]]; then
    if [ "$ROLLBACK_MODE" = ready ]; then
      printf '%s\n' '{"ready":false}' >"$output_file"
    else
      printf '%s\n' '{"ready":true}' >"$output_file"
    fi
  fi
  printf '200'
  return 0
}
sleep() { :; }
restore_previous_release_state
status=$?
if [ -f "$CURRENT_STATE_FILE" ]; then
  current=present
else
  current=absent
fi
printf 'status=%s result=%s current=%s\n' "$status" "$ROLLBACK_RESULT" "$current"
`,
          'staging-rollback-test',
          stagingRollbackHelperPath,
          tempDir,
          mode,
          resolve(projectRoot, 'scripts/lib/release-state.sh'),
          resolve(projectRoot, 'scripts/lib/release-runtime.sh'),
        ],
        { cwd: projectRoot, encoding: 'utf-8' }
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  function runProductionRollbackPreflightHarness({
    imageSource,
    includeAptSuite,
    staleAptSuite = 'unstable',
  }: {
    imageSource: 'release-candidate' | 'source-build';
    includeAptSuite: boolean;
    staleAptSuite?: string;
  }) {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-production-rollback-'));
    const appDir = resolve(tempDir, 'app');
    const stateDir = resolve(tempDir, 'release-state');
    const envPath = resolve(appDir, 'config/.env');
    const callsPath = resolve(tempDir, 'mutations.log');
    const previousStatePath = resolve(stateDir, 'previous-images.env');
    const currentStatePath = resolve(stateDir, 'current-images.env');
    const apiImage = `openpath-api@sha256:${'a'.repeat(64)}`;

    mkdirSync(resolve(appDir, 'config'), { recursive: true });
    mkdirSync(resolve(appDir, 'docker'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(envPath, 'SENTINEL=unchanged\n', 'utf-8');
    writeFileSync(
      previousStatePath,
      [
        'RELEASE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'RC_RUN_ID=123',
        'APP_SHA=previous-sha',
        'OPENPATH_SHA=cccccccccccccccccccccccccccccccccccccccc',
        'OPENPATH_CONTRACT_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        `IMAGE_SOURCE=${imageSource}`,
        'CLASSROOMPATH_GATEWAY_IMAGE=gateway:previous',
        'CLASSROOMPATH_MIGRATIONS_IMAGE=migrations:previous',
        'OPENPATH_FIREFOX_ASSETS_IMAGE=firefox-assets:previous',
        `OPENPATH_API_IMAGE=${apiImage}`,
        'OPENPATH_VERSION=4.1.19',
        'OPENPATH_LINUX_AGENT_VERSION=4.1.19',
        ...(includeAptSuite ? ['OPENPATH_LINUX_AGENT_APT_SUITE=stable'] : []),
        'CLASSROOMPATH_SPA_IMAGE=spa:previous',
        'CLASSROOMPATH_VERIFIER_IMAGE=verifier@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=template-commit',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=scripts-v4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = spawnSync(
      'bash',
      [
        '-c',
        String.raw`set -u
export CLASSROOMPATH_DEPLOY_ROOT="$1"
export APP_DIR="$1/app"
export OPENPATH_LINUX_AGENT_APT_SUITE="$2"
export CALLS_FILE="$1/mutations.log"
git() { printf 'git %s\n' "$*" >>"$CALLS_FILE"; return 97; }
docker() { printf 'docker %s\n' "$*" >>"$CALLS_FILE"; return 97; }
curl() { printf 'curl %s\n' "$*" >>"$CALLS_FILE"; return 97; }
export -f git docker curl
bash "$3"
`,
        'production-rollback-preflight-test',
        tempDir,
        staleAptSuite,
        productionRollbackScriptPath,
      ],
      { cwd: projectRoot, encoding: 'utf-8' }
    );

    const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '';
    const envText = readFileSync(envPath, 'utf-8');
    const currentStateExists = existsSync(currentStatePath);
    rmSync(tempDir, { recursive: true, force: true });

    return { result, calls, envText, currentStateExists };
  }

  function runProductionRollbackSuccessHarness() {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-production-rollback-success-'));
    const appDir = resolve(tempDir, 'app');
    const stateDir = resolve(tempDir, 'release-state');
    const envPath = resolve(appDir, 'config/.env');
    const callsPath = resolve(tempDir, 'mutations.log');
    const previousStatePath = resolve(stateDir, 'previous-images.env');
    const currentStatePath = resolve(stateDir, 'current-images.env');
    const apiImage = `openpath-api@sha256:${'a'.repeat(64)}`;

    mkdirSync(resolve(appDir, 'config'), { recursive: true });
    mkdirSync(resolve(appDir, 'docker'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      envPath,
      [
        'OPENPATH_VERSION=stale',
        'OPENPATH_LINUX_AGENT_VERSION=stale',
        'OPENPATH_LINUX_AGENT_APT_SUITE=unstable',
        '',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(
      previousStatePath,
      [
        'RELEASE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'RC_RUN_ID=123',
        'APP_SHA=previous-sha',
        'OPENPATH_SHA=cccccccccccccccccccccccccccccccccccccccc',
        'OPENPATH_CONTRACT_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'IMAGE_SOURCE=release-candidate',
        'CLASSROOMPATH_GATEWAY_IMAGE=gateway:previous',
        'CLASSROOMPATH_MIGRATIONS_IMAGE=migrations:previous',
        'OPENPATH_FIREFOX_ASSETS_IMAGE=firefox-assets:previous',
        `OPENPATH_API_IMAGE=${apiImage}`,
        'OPENPATH_VERSION=4.1.19',
        'OPENPATH_LINUX_AGENT_VERSION=4.1.19',
        'OPENPATH_LINUX_AGENT_APT_SUITE=stable',
        'CLASSROOMPATH_SPA_IMAGE=spa:previous',
        'CLASSROOMPATH_VERIFIER_IMAGE=verifier@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=template-commit',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=scripts-v4.1.0',
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = spawnSync(
      'bash',
      [
        '-c',
        String.raw`set -u
export CLASSROOMPATH_DEPLOY_ROOT="$1"
export APP_DIR="$1/app"
export GHCR_USERNAME=test-user
export GHCR_TOKEN=test-token
export OPENPATH_FIREFOX_RELEASE_HOST_ROOT="$1/firefox-release"
export PRODUCTION_CONTAINER_PLATFORM=linux/amd64
export PRODUCTION_ROLLBACK_PUBLIC_URL=http://localhost:3001
export PRODUCTION_ROLLBACK_READINESS_ATTEMPTS=1
export PRODUCTION_ROLLBACK_READINESS_DELAY_SECONDS=0
export PRODUCTION_ROLLBACK_CURL_TIMEOUT_SECONDS=1
export NODE_BIN="$3"
export CALLS_FILE="$1/mutations.log"
    git() {
      printf 'git %s\n' "$*" >>"$CALLS_FILE"
      if [ "$1" = rev-parse ]; then
        printf '%s\n' "$OPENPATH_SHA"
      fi
      return 0
    }
docker() {
  printf 'docker %s\n' "$*" >>"$CALLS_FILE"
  case "$1" in
    create)
      printf 'fake-container\n'
      ;;
    cp)
      local destination="\${!#}"
      mkdir -p "$(dirname "$destination")"
      case "$destination" in
        *metadata.json) printf '%s\n' '{"version":"4.1.0"}' >"$destination" ;;
        *openpath-firefox-extension.xpi) printf '%s\n' 'fake-xpi' >"$destination" ;;
      esac
      ;;
  esac
  return 0
}
curl() {
  local output_file="/dev/null"
  local url=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o) output_file="$2"; shift 2 ;;
      -w|--max-time) shift 2 ;;
      -fsS) shift ;;
      *) url="$1"; shift ;;
    esac
  done
  if [[ "$url" == *"/cp/ready"* ]]; then
    printf '%s\n' '{"ready":true}' >"$output_file"
    printf '200'
    return 0
  fi
  if [[ "$url" == *"/cp/health"* ]]; then
    printf '200'
    return 0
  fi
  return 22
}
export -f git docker curl
bash "$2"
`,
        'production-rollback-success-test',
        tempDir,
        productionRollbackScriptPath,
        process.execPath,
      ],
      { cwd: projectRoot, encoding: 'utf-8' }
    );

    const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '';
    const envText = readFileSync(envPath, 'utf-8');
    const currentState = existsSync(currentStatePath)
      ? readFileSync(currentStatePath, 'utf-8')
      : '';
    rmSync(tempDir, { recursive: true, force: true });

    return { result, calls, envText, currentState };
  }

  test('production rollback rejects source-build before checkout or Docker mutation', () => {
    const outcome = runProductionRollbackPreflightHarness({
      imageSource: 'source-build',
      includeAptSuite: true,
    });

    assert.notEqual(outcome.result.status, 0, outcome.result.stdout);
    assert.match(`${outcome.result.stdout}\n${outcome.result.stderr}`, /source-build/);
    assert.equal(outcome.calls, '');
    assert.equal(outcome.envText, 'SENTINEL=unchanged\n');
    assert.equal(outcome.currentStateExists, false);
  });

  test('production rollback rejects a release-candidate snapshot without APT suite before stale host state can leak', () => {
    const outcome = runProductionRollbackPreflightHarness({
      imageSource: 'release-candidate',
      includeAptSuite: false,
      staleAptSuite: 'unstable',
    });

    assert.notEqual(outcome.result.status, 0, outcome.result.stdout);
    assert.match(
      `${outcome.result.stdout}\n${outcome.result.stderr}`,
      /OPENPATH_LINUX_AGENT_APT_SUITE/
    );
    assert.equal(outcome.calls, '');
    assert.equal(outcome.envText, 'SENTINEL=unchanged\n');
    assert.equal(outcome.currentStateExists, false);
  });

  test('production release-candidate rollback restores the Linux agent version and APT suite together', () => {
    const outcome = runProductionRollbackSuccessHarness();

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.calls, /git checkout --detach previous-sha/u);
    assert.match(
      outcome.calls,
      /docker compose pull gateway api windows-offline-installer-provision spa/u
    );
    assert.match(outcome.calls, /docker compose up -d --force-recreate --no-build/u);
    assert.match(outcome.envText, /^OPENPATH_VERSION=4\.1\.19$/mu);
    assert.match(outcome.envText, /^OPENPATH_LINUX_AGENT_VERSION=4\.1\.19$/mu);
    assert.match(outcome.envText, /^OPENPATH_LINUX_AGENT_APT_SUITE=stable$/mu);
    assert.match(outcome.currentState, /^OPENPATH_LINUX_AGENT_APT_SUITE=stable$/mu);
    assert.doesNotMatch(outcome.envText, /^OPENPATH_LINUX_AGENT_APT_SUITE=unstable$/mu);
  });

  test('staging rollback fails closed on compose pull/build/up failures', () => {
    for (const mode of ['release-pull', 'release-up', 'build', 'up']) {
      const result = runRollbackHarness(mode);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /status=1 result=(?:failed|not_attempted) current=absent/u, mode);
      assert.doesNotMatch(result.stdout, /result=success/u, mode);
    }
  });

  test('staging rollback requires both health and readiness before success', () => {
    const result = runRollbackHarness('ready');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status=1 result=(?:failed|not_attempted) current=absent/u);
    assert.doesNotMatch(result.stdout, /result=success/u);
  });

  test('staging rollback activates the previous state after valid health and readiness', () => {
    const result = runRollbackHarness('success');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status=0 result=success current=present\n/u);
  });

  test('shared rollback readiness gate activates only after valid health and ready:true JSON', () => {
    for (const scenario of [
      { name: 'valid readiness', expectedState: 'active', readyResponse: '{"ready":true}' },
      { name: 'ready false', expectedState: 'inactive', readyResponse: '{"ready":false}' },
      { name: 'invalid JSON', expectedState: 'inactive', readyResponse: 'not-json' },
      {
        name: 'JSON-looking trailing garbage',
        expectedState: 'inactive',
        readyResponse: '{"ready":true} trailing',
      },
      {
        name: 'string ready value',
        expectedState: 'inactive',
        readyResponse: '{"ready":"true"}',
      },
    ]) {
      const result = runRollbackReadinessHarness({ readyResponse: scenario.readyResponse });
      assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}`);
      assert.match(
        result.stdout,
        new RegExp(`state=${scenario.expectedState}\\n`, 'u'),
        scenario.name
      );
    }

    for (const scenario of [
      { name: 'health HTTP failure', healthHttpStatus: 503 },
      { name: 'readiness HTTP failure', readyHttpStatus: 503 },
      { name: 'health curl failure', healthCurlStatus: 22 },
      { name: 'readiness curl failure', readyCurlStatus: 22 },
    ]) {
      const result = runRollbackReadinessHarness(scenario);
      assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}`);
      assert.match(result.stdout, /state=inactive\n/u, scenario.name);
    }
  });

  test('staging and production rollback consume the same readiness gate before activation', () => {
    const stagingContent = readFileSync(stagingRollbackHelperPath, 'utf-8');
    const productionContent = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const readinessContent = readFileSync(rollbackReadinessHelperPath, 'utf-8');

    assert.ok(readinessContent.includes('JSON.parse'));
    assert.ok(readinessContent.includes('parsed.ready === true'));
    assert.ok(stagingContent.includes('rollback_wait_for_health_and_readiness'));
    assert.ok(productionContent.includes('rollback_wait_for_health_and_readiness'));
    assert.ok(
      productionContent.indexOf('rollback_wait_for_health_and_readiness') <
        productionContent.indexOf('deployment_state_activate_previous_release'),
      'production must activate the state only after the shared readiness gate'
    );
  });

  test('staging deploy requires a successful release-candidate manifest for origin main', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const releasePlanContent = readFileSync(releasePlanScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const releaseCandidateWorkflowContent = readFileSync(
      resolve(projectRoot, '.github/workflows/release-candidate-images.yml'),
      'utf-8'
    );
    const releaseCandidateWorkflow = readProjectWorkflow(
      '.github/workflows/release-candidate-images.yml'
    );

    assert.ok(existsSync(releaseImagesScriptPath));
    assert.ok(existsSync(waitForReleaseCandidateScriptPath));
    assert.ok(
      localContent.includes('prepare_staging_local_release_context') &&
        releaseHelperContent.includes(
          'node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-bundle'
        )
    );
    assert.deepEqual(releaseCandidateWorkflow.on?.push?.branches, ['main']);
    assert.ok(
      !Object.hasOwn(releaseCandidateWorkflow.on?.push ?? {}, 'paths'),
      'release-candidate images should refresh on every main push, including promotion-eligible staging deploy logic changes'
    );
    assert.ok(
      releaseHelperContent.includes('warn_if_other_release_candidate_run_in_progress "$REMOTE_SHA"')
    );
    assert.ok(
      releaseHelperContent.includes('--workflow release-candidate-images.yml') &&
        releaseHelperContent.includes('--status in_progress') &&
        releaseHelperContent.includes('--json databaseId,headSha,url')
    );
    assert.ok(
      releaseHelperContent.includes(
        'Old release-candidate workflow still in progress: run_id=${runId} sha=${headSha} url=${url ||'
      )
    );
    assert.ok(releaseHelperContent.includes('Manual cleanup command: gh run cancel ${runId}'));
    assert.ok(remoteContent.includes('deploy_with_release_candidates'));
    assert.ok(
      remoteContent.includes(
        'docker compose pull gateway api windows-offline-installer-provision spa'
      )
    );
    assert.ok(localContent.includes('Allowed value: release-candidate'));
    assert.ok(localContent.includes('does not support source-build staging deploys'));
    assert.ok(
      releaseHelperContent.includes('STAGING_RELEASE_MANIFEST_FILE') &&
        releaseHelperContent.includes('STAGING_RELEASE_MANIFEST_B64')
    );
    assert.ok(releasePlanContent.includes('release-candidate manifest APP_SHA'));
    assert.ok(
      releaseHelperContent.includes('STAGING_RELEASE_RUN_ID') &&
        releaseHelperContent.includes('STAGING_RELEASE_REPOSITORY')
    );
    assert.ok(releaseHelperContent.includes('git rev-parse HEAD:upstream/openpath'));
    assert.ok(
      localContent.includes(
        'STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS="${STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS:-${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-3600}}"'
      )
    );
    assert.ok(
      localContent.includes(
        'STAGING_RELEASE_WAIT_TIMEOUT_SECONDS="${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-$STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS}"'
      )
    );
    assert.ok(releaseHelperContent.includes('STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS'));
    assert.ok(
      remoteContent.includes('release_bundle_base64') &&
        remoteContent.includes('openpath_contract_base64') &&
        remoteContent.includes('node "$APP_DIR/scripts/release-bundle.mjs" verify')
    );
    assert.ok(
      remoteContent.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
      ) &&
        remoteContent.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"'
        )
    );
    assert.ok(
      !localContent.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"')
    );
    assert.ok(!localContent.includes('Falling back to source build for staging'));
    assert.ok(!localContent.includes('source-build|'));
  });

  test('staging deploy warns about other in-progress release-candidate runs without cancelling them', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-gh-'));
    const fakeGhPath = resolve(tempDir, 'gh');

    writeFileSync(
      fakeGhPath,
      `#!/bin/sh
case "$*" in
  *"run list"*)
    printf '%s\\n' '[{"databaseId":12345,"headSha":"other-sha","url":"https://github.com/balejosg/ClassroomPath/actions/runs/12345"},{"databaseId":67890,"headSha":"target-sha","url":"https://github.com/balejosg/ClassroomPath/actions/runs/67890"}]'
    exit 0
    ;;
  *"run cancel"*)
    echo "cancel should not be called" >&2
    exit 99
    ;;
esac
echo "unexpected gh invocation: $*" >&2
exit 2
`
    );
    chmodSync(fakeGhPath, 0o755);

    try {
      const output = execFileSync(
        'bash',
        [
          '-c',
          `
set -euo pipefail
source "$1"
log_warn() { echo "WARN:$*"; }
warn_if_other_release_candidate_run_in_progress target-sha
`,
          'bash',
          stagingLocalReleaseHelperPath,
        ],
        {
          cwd: projectRoot,
          encoding: 'utf-8',
          env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          },
        }
      );

      assert.match(
        output,
        /WARN:Old release-candidate workflow still in progress: run_id=12345 sha=other-sha url=https:\/\/github\.com\/balejosg\/ClassroomPath\/actions\/runs\/12345/
      );
      assert.match(output, /WARN:Manual cleanup command: gh run cancel 12345/);
      assert.doesNotMatch(output, /67890/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test('staging deploy records reusable smoke, release-gate, and Windows/Firefox evidence', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const verifyHelperContent = readFileSync(stagingLocalVerifyHelperPath, 'utf-8');
    const releaseGateHelperContent = readFileSync(stagingReleaseGateScriptPath, 'utf-8');
    const persistHelperContent = readFileSync(stagingVerifyStateScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(existsSync(stagingVerifyStateScriptPath));
    assert.ok(existsSync(stagingVerificationRunnerPath));
    assert.ok(localContent.includes('STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"'));
    assert.ok(
      releaseHelperContent.includes('STAGING_DEPLOYMENT_MODE') &&
        releaseHelperContent.includes('cannot produce promotion evidence')
    );
    assert.ok(existsSync(stagingReleaseGateScriptPath));
    assert.ok(
      releaseGateHelperContent.includes(
        'exec bash "$SCRIPT_DIR/run-staging-verification.sh" release-gate "$@"'
      )
    );
    assert.ok(stagingGatesHelper.includes('RELEASE_GATE_URL=$canonical_staging_url'));
    assert.ok(
      runnerContent.includes('source "$SCRIPT_DIR/lib/staging-gates.sh"') &&
        stagingGatesHelper.includes('run_gate_command()')
    );
    assert.ok(
      verifyHelperContent.includes('build_staging_verify_state_env_cmd()') &&
        verifyHelperContent.includes('run_staging_local_verification()')
    );
    assert.ok(
      stagingGatesHelper.includes('run_gate_command smoke') &&
        stagingGatesHelper.includes('run_gate_command release-gate') &&
        stagingGatesHelper.includes('run_gate_command windows-bootstrap-gate')
    );
    assert.ok(
      stagingGatesHelper.includes('print_staging_public_ingress_diagnostics()') &&
        stagingGatesHelper.includes('https://api.ipify.org') &&
        stagingGatesHelper.includes('dig @1.1.1.1') &&
        stagingGatesHelper.includes('curl --max-time'),
      'staging smoke failures should include public DNS and ingress diagnostics'
    );
    assert.ok(
      persistHelperContent.includes('staging-verification.env') &&
        persistHelperContent.includes(
          'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=${STAGING_FIREFOX_RELEASE_ARTIFACTS:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_ENROLLMENT_DOWNLOAD_RESULT=${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT=${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT=${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_FIREFOX_POLICY_RESULT=${STAGING_FIREFOX_POLICY_RESULT:-}'
        )
    );
    assert.ok(
      persistHelperContent.includes('STAGING_FIREFOX_EXTENSION_ID=') &&
        persistHelperContent.includes('STAGING_FIREFOX_RELEASE_VERSION=') &&
        persistHelperContent.includes('STAGING_FIREFOX_SIGNATURE_SOURCE=') &&
        persistHelperContent.includes('STAGING_FIREFOX_SIGNATURE_STATE=') &&
        persistHelperContent.includes('STAGING_FIREFOX_METADATA_SHA256=') &&
        persistHelperContent.includes('STAGING_FIREFOX_XPI_SHA256=')
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /openpath-firefox-release/metadata.json'
      ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /openpath-firefox-release/openpath-firefox-extension.xpi'
        ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /app/runtime/browser-policy-spec.json'
        )
    );
    assert.ok(
      stagingGatesHelper.includes('STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE') &&
        stagingGatesHelper.includes('run_staging_enrollment_download_gate') &&
        stagingGatesHelper.includes('STAGING_ENROLLMENT_DOWNLOAD_RESULT') &&
        stagingGatesHelper.includes(
          'Release-candidate staging deploys must prove the live Windows bootstrap contract'
        )
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"'
      ) &&
        localContent.includes(
          'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
        )
    );
    assert.ok(
      verifyHelperContent.includes(
        'bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"'
      )
    );
    assert.ok(
      runnerContent.includes('run_smoke_subcommand "$smoke_state_file"') &&
        runnerContent.includes('run_release_gate_subcommand "$release_gate_state_file"') &&
        runnerContent.includes('wait "$smoke_pid"') &&
        runnerContent.includes('wait "$release_gate_pid"') &&
        runnerContent.includes('read_staging_state_value "$smoke_state_file" STAGING_SMOKE_RESULT'),
      'staging collect should run smoke in parallel with the release-gate/windows-bootstrap chain and merge evidence'
    );
    assert.ok(
      verifyHelperContent.includes('mark_staging_local_verification_failed()') &&
        verifyHelperContent.includes('DEPLOY_FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('write_deploy_context_state "$DEPLOY_CONTEXT_FILE"'),
      'staging deploy should overwrite the remote deploy context when post-deploy verification fails'
    );
  });

  test('promotion-eligible staging deploy invalidates stale verification evidence before remote deploy', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');

    assert.ok(
      releaseHelperContent.includes('invalidate_staging_verification_evidence_for_release()') &&
        releaseHelperContent.includes('"$STAGING_VERIFICATION_RUNNER_PATH" invalidate') &&
        releaseHelperContent.includes('STAGING_RELEASE_SHA') &&
        releaseHelperContent.includes('UPSTREAM_OPENPATH_SHA') &&
        releaseHelperContent.includes('STAGING_IMAGE_SOURCE'),
      'staging local release helper should write pending evidence for the target release'
    );
    assert.ok(
      runnerContent.includes('run_invalidate_subcommand()') &&
        runnerContent.includes('write_staging_verification_pending_state'),
      'shared staging verification runner should expose a reusable invalidate subcommand'
    );
    assert.ok(
      localContent.includes('invalidate_staging_verification_evidence_for_release') &&
        localContent.indexOf('invalidate_staging_verification_evidence_for_release') <
          localContent.indexOf('run_staging_local_remote_deploy'),
      'stale staging verification evidence should be invalidated before the remote deploy starts'
    );
  });

  test('staging deploy delegates health polling and smoke execution to dedicated helpers', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const verifyHelperContent = readFileSync(stagingLocalVerifyHelperPath, 'utf-8');
    const healthHelperContent = readFileSync(stagingHealthCheckScriptPath, 'utf-8');
    const smokeHelperContent = readFileSync(stagingSmokeScriptPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(existsSync(stagingHealthCheckScriptPath));
    assert.ok(existsSync(stagingSmokeScriptPath));
    assert.ok(
      localContent.includes(
        'STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"'
      )
    );
    assert.ok(localContent.includes('run_staging_local_health_checks'));
    assert.ok(
      verifyHelperContent.includes(
        'bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}"'
      )
    );
    assert.ok(healthHelperContent.includes('curl -sf http://localhost:3000/cp/ready 2>/dev/null'));
    assert.ok(healthHelperContent.includes('curl -sf http://localhost:3000/health 2>/dev/null'));
    assert.ok(
      smokeHelperContent.includes('exec bash "$SCRIPT_DIR/run-staging-verification.sh" smoke "$@"')
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      )
    );
    assert.ok(
      stagingGatesHelper.includes(
        'bash "$STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH" "$target_host"'
      ) &&
        stagingGatesHelper.includes('run_gate_command smoke') &&
        stagingGatesHelper.includes('SMOKE_TEST_RESOLVED_ADDRESS=')
    );
  });

  test('production deploy uses release-candidate migrations and verifies staging evidence first', () => {
    const workflowContent = readFileSync(deployWorkflowPath, 'utf-8');
    const deployRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const deployContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const deployRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const remoteDeployScaffoldHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
      'utf-8'
    );
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const releaseStateHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-state.sh'),
      'utf-8'
    );

    assert.ok(
      workflowContent.includes(
        'RELEASE_BUNDLE_B64: ${{ steps.release-bundle.outputs.release_bundle_base64 }}'
      ) &&
        workflowContent.includes(
          'OPENPATH_CONTRACT_B64: ${{ steps.release-bundle.outputs.openpath_contract_base64 }}'
        ) &&
        workflowContent.includes('RELEASE_ID: ${{ steps.release-bundle.outputs.release_id }}')
    );
    assert.ok(workflowContent.includes('OPENPATH_LINUX_AGENT_VERSION'));
    assert.ok(workflowContent.includes('OPENPATH_LINUX_AGENT_APT_SUITE'));
    assert.ok(workflowContent.includes('verify-staging-release-state'));
    assert.ok(
      deployRemoteScript.includes(
        'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
      )
    );
    assert.ok(workflowContent.includes('staging-verification.env'));
    assert.ok(releaseStateHelper.includes('STAGING_RELEASE_GATE_RESULT'));
    assert.ok(
      releaseStateHelper.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT') &&
        releaseStateHelper.includes('STAGING_ENROLLMENT_DOWNLOAD_RESULT') &&
        releaseStateHelper.includes('STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT') &&
        releaseStateHelper.includes('STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT') &&
        releaseStateHelper.includes('STAGING_FIREFOX_POLICY_RESULT') &&
        releaseStateHelper.includes('PASS_WITH_FALLBACK')
    );
    assert.ok(!workflowContent.includes('name: Release Gate Staging'));
    assert.ok(workflowContent.includes('Verify production release image platforms'));
    assert.ok(workflowContent.includes('verify-release-manifest-platforms.mjs'));
    assert.ok(workflowContent.includes('PRODUCTION_CONTAINER_PLATFORM'));
    assert.ok(!workflowContent.includes('run: sleep 30'));
    assert.ok(
      deployRuntimeHelper.includes('write_release_runtime_state') &&
        deployRuntimeHelper.includes('OPENPATH_FIREFOX_ASSETS_IMAGE') &&
        deployRuntimeHelper.includes('"${OPENPATH_LINUX_AGENT_VERSION:-}"') &&
        deployRuntimeHelper.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
        ) &&
        deployRuntimeHelper.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"'
        )
    );
    assert.ok(
      deployContextHelper.includes('DEPLOY_RELEASE_BUNDLE_B64') &&
        deployContextHelper.includes('DEPLOY_OPENPATH_CONTRACT_B64') &&
        deployContextHelper.includes('release-bundle.mjs" verify') &&
        deployContextHelper.includes(
          'export RELEASE_ID APP_SHA OPENPATH_SHA OPENPATH_CONTRACT_SHA256'
        )
    );
    assert.ok(
      deployRemoteScript.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        deployRemoteScript.includes(
          'remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"'
        ) &&
        remoteDeployScaffoldHelper.includes(
          'COMMON_SH_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/common.sh")"'
        )
    );
    assert.ok(
      deployContextHelper.includes('release_execution_classify_and_gate_production_migrations') &&
        !deployContextHelper.includes('classify_sql_migration_file()') &&
        !deployContextHelper.includes('classify_migration_risk() {')
    );
    assert.ok(!deployRemoteScript.includes('upsert_env_file_var() {'));
    assert.ok(
      deployRemoteScript.includes('git submodule update --init --recursive --force') &&
        deployRemoteScript.includes('remote_deploy_reload_checked_out_helpers')
    );
    assert.ok(
      rollbackRemoteScript.includes('OPENPATH_FIREFOX_ASSETS_IMAGE') &&
        rollbackRemoteScript.includes('release_runtime_helper_supports_runtime_contract') &&
        rollbackRemoteScript.includes('source "$RELEASE_RUNTIME_HELPER_PATH"') &&
        rollbackRemoteScript.includes('release_state_require_snapshot_fields') &&
        rollbackRemoteScript.includes('require_openpath_linux_agent_runtime_pin') &&
        rollbackRemoteScript.includes('require_windows_offline_installer_runtime_pin') &&
        rollbackRemoteScript.includes('IMAGE_SOURCE') &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE'
        ) &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release'
        ) &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION'
        ) &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT'
        ) &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG'
        ) &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256'
        ) &&
        rollbackRemoteScript.includes(
          'prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "$APP_SHA"'
        ) &&
        rollbackRemoteScript.includes(
          'docker compose pull gateway api windows-offline-installer-provision spa'
        ) &&
        rollbackRemoteScript.includes('lib/rollback-readiness.sh') &&
        rollbackRemoteScript.includes('rollback_wait_for_health_and_readiness')
    );
    assert.ok(!rollbackRemoteScript.includes('upsert_env_file_var() {'));
  });

  test('production rollback is release-candidate-only and validates metadata before mutations', () => {
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const snapshotPreflightIndex = rollbackRemoteScript.indexOf(
      'deployment_state_v2_pointer_present previous'
    );
    const previousLoadIndex = rollbackRemoteScript.indexOf(
      'deployment_state_load_previous_release'
    );
    const checkoutIndex = rollbackRemoteScript.indexOf('git checkout --detach');

    assert.ok(
      snapshotPreflightIndex >= 0,
      'production rollback must validate the previous v2 pointer'
    );
    assert.ok(previousLoadIndex >= 0, 'production rollback must load the previous state');
    assert.ok(checkoutIndex >= 0, 'production rollback must retain the checkout step');
    assert.ok(
      snapshotPreflightIndex < previousLoadIndex && previousLoadIndex < checkoutIndex,
      'snapshot and source policy checks must precede loading and checkout'
    );
    assert.match(rollbackRemoteScript, /source-build.*not supported|only.*release-candidate/u);
    assert.doesNotMatch(rollbackRemoteScript, /source-build\)\s*;;/u);
  });

  test('production rollback activates the previous state only after health and readiness pass', () => {
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const activationIndex = rollbackRemoteScript.indexOf(
      'deployment_state_activate_previous_release'
    );
    const readinessGateIndex = rollbackRemoteScript.indexOf(
      'if ! rollback_wait_for_health_and_readiness'
    );
    const readinessSuccessIndex = rollbackRemoteScript.indexOf(
      'log_success "Rollback health and readiness checks passed"'
    );

    assert.ok(activationIndex >= 0, 'production rollback must activate a verified state');
    assert.ok(readinessGateIndex >= 0, 'production rollback must verify readiness');
    assert.ok(readinessSuccessIndex >= 0, 'production rollback must verify health and readiness');
    assert.ok(
      readinessGateIndex < activationIndex && activationIndex < readinessSuccessIndex,
      'a failed readiness check must not activate the previous release state'
    );
  });

  test('staging rollback restores the canonical OpenPath installer contract while keeping source-build staging-only', () => {
    const stagingRuntime = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const rollbackHelper = readFileSync(stagingRollbackHelperPath, 'utf-8');

    assert.ok(
      stagingRuntime.includes('load_staging_rollback_helper') &&
        stagingRuntime.includes('source "$STAGING_ROLLBACK_HELPER_PATH"') &&
        rollbackHelper.includes('restore_previous_release_state()')
    );
    assert.ok(
      rollbackHelper.includes('source "$STAGING_ROLLBACK_READINESS_HELPER_PATH"') &&
        readFileSync(rollbackReadinessHelperPath, 'utf-8').includes(
          'rollback_wait_for_health_and_readiness'
        )
    );
    assert.ok(rollbackHelper.includes('require_windows_offline_installer_runtime_pin'));
    assert.ok(rollbackHelper.includes('require_openpath_linux_agent_runtime_pin'));
    for (const field of [
      'OPENPATH_LINUX_AGENT_VERSION',
      'OPENPATH_LINUX_AGENT_APT_SUITE',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256',
    ]) {
      assert.ok(
        rollbackHelper.includes(`upsert_env_file_var "$app_dir/config/.env" ${field}`),
        `staging rollback must restore ${field} before rebuilding or starting the previous release`
      );
    }
    assert.ok(
      rollbackHelper.includes('windows-offline-installer-provision'),
      'staging release-candidate rollback must restore the OpenPath provisioner service'
    );
    assert.ok(
      rollbackHelper.includes('staging_rollback_wait_for_health_and_readiness') &&
        rollbackHelper.includes('ROLLBACK_RESULT="success"'),
      'rollback success must be gated by both health and readiness'
    );
  });

  test('production runbook exposes an explicit pre-tag promotion-ready gate', () => {
    const runbook = readFileSync(
      resolve(projectRoot, 'docs/runbooks/deploy-production.md'),
      'utf-8'
    );
    const secretsDoc = readFileSync(resolve(projectRoot, 'docs/SECRETS.md'), 'utf-8');
    const packageJson = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');
    const promotionReadyScript = readFileSync(promotionReadyScriptPath, 'utf-8');
    const tagProductionScript = readFileSync(
      resolve(projectRoot, 'scripts/tag-production-release.sh'),
      'utf-8'
    );
    const promoteCurrentScript = readFileSync(
      resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
      'utf-8'
    );
    const productionHostReadinessScript = readFileSync(productionHostReadinessScriptPath, 'utf-8');
    const productionTargetPreflightScript = readFileSync(
      productionTargetPreflightScriptPath,
      'utf-8'
    );

    assert.ok(existsSync(promotionReadyScriptPath));
    assert.ok(existsSync(productionHostReadinessScriptPath));
    assert.ok(existsSync(productionTargetPreflightScriptPath));
    assert.ok(
      promotionReadyScript.includes('release-state-cli.mjs') &&
        promotionReadyScript.includes('verify-promotion-ready') &&
        promotionReadyScript.includes('wait-for-release-candidate.mjs') &&
        promotionReadyScript.includes('resolve-bundle') &&
        promotionReadyScript.includes('staging_rc_run_id') &&
        promotionReadyScript.includes('--run-id "$staging_rc_run_id"') &&
        promotionReadyScript.includes('RC_RUN_ID="$staging_rc_run_id"') &&
        promotionReadyScript.includes('source "$SCRIPT_DIR/lib/deploy-container-platform.sh"') &&
        promotionReadyScript.includes('verify_production_container_platform_ready') &&
        promotionReadyScript.includes('configure_deploy_container_platform "$target_platform"')
    );
    assert.ok(!promotionReadyScript.includes('qemu-x86_64'));
    assert.ok(promotionReadyScript.includes('PROMOTION_EVIDENCE_DIR'));
    assert.ok(tagProductionScript.includes('promotion-evidence-cli.mjs'));
    assert.ok(
      tagProductionScript.includes('git tag -a "$TAG_NAME" "$main_sha" -F "$tag_message_file"')
    );
    assert.ok(
      runbook.includes(
        'The public repository intentionally does not document production deployment commands or live targets.'
      )
    );
    assert.ok(secretsDoc.includes('Use `npm run verify:public-surface`'));
    assert.ok(packageJson.includes('"verify:production-host"'));
    assert.ok(packageJson.includes('"verify:production-target-ready"'));
    assert.ok(packageJson.includes('bash scripts/preflight-production-promotion-target.sh'));
    assert.ok(
      packageJson.includes('"deploy:staging:assume-yes"'),
      'package.json should expose an explicit non-interactive staging deploy command'
    );
    assert.ok(
      packageJson.includes('env DEPLOY_ASSUME_YES=1 npm run deploy:staging'),
      'deploy:staging:assume-yes should use the portable env prefix form'
    );
    assert.ok(
      promotionReadyScript.includes(
        'node "$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl'
      ) &&
        promotionReadyScript.includes('DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"') &&
        !promotionReadyScript.includes('DEPLOY_HOST must be set before production promotion'),
      'promotion-ready should derive production host and SSH key defaults from canonical local config'
    );
    assert.ok(
      productionHostReadinessScript.includes('verify_host_arch_matches_target_platform') &&
        productionHostReadinessScript.includes('linux/arm64') &&
        productionHostReadinessScript.includes(
          ': "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"'
        ) &&
        productionHostReadinessScript.includes('app_dir="${deploy_root%/}/app"') &&
        productionHostReadinessScript.includes('test -d "$app_dir/.git"') &&
        productionHostReadinessScript.includes('docker compose version') &&
        productionHostReadinessScript.includes('docker info') &&
        productionHostReadinessScript.includes('current-images.env') &&
        !productionHostReadinessScript.includes('qemu-x86_64')
    );
    assert.ok(
      promotionReadyScript.includes(
        ': "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"'
      ) &&
        promotionReadyScript.includes(
          'PRODUCTION_CURRENT_STATE_PATH="${PRODUCTION_DEPLOY_ROOT%/}/release-state/current-images.env"'
        ) &&
        !promotionReadyScript.includes(
          'test -f /srv/classroompath/release-state/current-images.env'
        ),
      'promotion readiness should read production release state from CLASSROOMPATH_DEPLOY_ROOT'
    );
    assert.ok(
      productionTargetPreflightScript.includes(
        ': "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"'
      ) &&
        productionTargetPreflightScript.includes(
          'PRODUCTION_CURRENT_STATE_PATH="${CLASSROOMPATH_DEPLOY_ROOT%/}/release-state/current-images.env"'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production gatewayHealthUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production readyUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production containerPlatform'
        ) &&
        productionTargetPreflightScript.includes('"${PRODUCTION_SSH_CMD[@]}" "true"') &&
        productionTargetPreflightScript.includes("test -r '$PRODUCTION_CURRENT_STATE_PATH'") &&
        productionTargetPreflightScript.includes('curl --max-time 15') &&
        productionTargetPreflightScript.includes(
          'grep -q \'require_cmd node\' "$SCRIPT_DIR/deploy-production-remote.sh"'
        ) &&
        productionTargetPreflightScript.includes('classify_migration_risk_without_node()'),
      'production target preflight should verify SSH, release-state, URLs, platform, and no-host-node deploy contract'
    );
    assert.ok(
      tagProductionScript.indexOf('bash scripts/preflight-production-promotion-target.sh') >
        tagProductionScript.indexOf('bash scripts/verify-production-promotion-ready.sh') &&
        tagProductionScript.indexOf('bash scripts/preflight-production-promotion-target.sh') <
          tagProductionScript.indexOf('git tag -a "$TAG_NAME"'),
      'manual production tagging should run production target preflight before tag creation'
    );
    assert.ok(
      promoteCurrentScript.indexOf('bash "$SCRIPT_DIR/preflight-production-promotion-target.sh"') >
        promoteCurrentScript.indexOf('bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"') &&
        promoteCurrentScript.indexOf(
          'bash "$SCRIPT_DIR/preflight-production-promotion-target.sh"'
        ) < promoteCurrentScript.indexOf('git tag -a "$next_tag"'),
      'latest-only production tagging should run production target preflight before tag creation'
    );
    assert.ok(
      productionHostReadinessScript.includes(
        'DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"'
      ) && productionHostReadinessScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'production host readiness should not depend on /etc/ssh/ssh_config.d'
    );
    assert.ok(
      productionHostReadinessScript.includes(
        'DEPLOY_HOST="${1:-${DEPLOY_HOST:-$(resolve_default_deploy_host)}}"'
      ) &&
        productionHostReadinessScript.includes(
          'DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"'
        ),
      'production host readiness should default to canonical production host and key when available'
    );
    assert.ok(
      promotionReadyScript.includes('STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('-F "$STAGING_SSH_CONFIG"') &&
        promotionReadyScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'promotion readiness should isolate both staging and production SSH clients'
    );
    assert.ok(
      promotionReadyScript.includes('git rev-parse "$TARGET_SHA:upstream/openpath"') &&
        promotionReadyScript.includes('OPENPATH_SHA="$openpath_sha"') &&
        promotionReadyScript.includes('OPENPATH_BASE_SHA="$openpath_base_sha"') &&
        promotionReadyScript.includes(
          'node "$SCRIPT_DIR/openpath-required-checks.mjs" report || true'
        ) &&
        promotionReadyScript.includes('node "$SCRIPT_DIR/openpath-required-checks.mjs" wait'),
      'promotion readiness should verify required OpenPath checks for the exact staged submodule SHA'
    );
    assert.ok(
      promotionReadyScript.indexOf('node "$SCRIPT_DIR/openpath-required-checks.mjs"') <
        promotionReadyScript.indexOf(
          'log_success "Staging release for $TARGET_SHA is promotion-ready"'
        ),
      'OpenPath required checks should pass before promotion-ready can be reported'
    );
    assert.ok(
      promotionReadyScript.includes('prepromotion-runner-rehearsal.mjs" verify') &&
        promotionReadyScript.includes('--changed-files "$openpath_changed_files_file"') &&
        promotionReadyScript.includes('--target-sha "$TARGET_SHA"'),
      'promotion readiness should enforce the selective prepromotion runner rehearsal evidence'
    );
    const stagingReleaseHelper = readFileSync(stagingLocalReleaseHelperPath, 'utf8');
    assert.ok(
      stagingReleaseHelper.includes('Promotion-eligible staging requires a clean worktree') &&
        stagingReleaseHelper.includes('resolve_active_release_fence_id "$workspace_guard"') &&
        stagingReleaseHelper.includes(
          'Promotion-eligible staging requires an active release fence id'
        ) &&
        stagingReleaseHelper.includes('release-mark-staged') &&
        stagingReleaseHelper.includes('--release-id "$STAGING_RELEASE_FENCE_ID"') &&
        stagingReleaseHelper.includes('--classroompath-sha "$REMOTE_SHA"'),
      'promotion-eligible staging should reject local dirt and mark the active release fence staged'
    );
    assert.ok(
      stagingReleaseHelper.includes(
        'local requested_staging_deployment_mode="$effective_staging_deployment_mode"'
      ) &&
        stagingReleaseHelper.includes(
          'if [ "$requested_staging_deployment_mode" = "debug" ]; then'
        ) &&
        stagingReleaseHelper.includes('STAGING_DEPLOYMENT_MODE="debug"'),
      'debug staging should preserve the requested no-fence deployment mode after rendering release candidate plans'
    );
    const tagScript = readFileSync(
      resolve(projectRoot, 'scripts/tag-production-release.sh'),
      'utf8'
    );
    assert.ok(
      tagScript.includes('release-status') &&
        tagScript.includes('resolve_active_release_fence_id "$fence_json" "$main_sha"') &&
        tagScript.includes('Release fence must be staged before production tagging') &&
        tagScript.includes('release-mark-tagged') &&
        tagScript.includes('--release-id "$release_fence_id"') &&
        tagScript.includes('--tag "$TAG_NAME"'),
      'production tagging should require a staged release fence and mark it tagged after tag creation'
    );
    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/lib/github-token.sh')),
      'local deployment scripts should share the GitHub token fallback helper'
    );
    for (const [scriptName, scriptContent] of [
      ['verify-production-promotion-ready.sh', promotionReadyScript],
      [
        'tag-production-release.sh',
        readFileSync(resolve(projectRoot, 'scripts/tag-production-release.sh'), 'utf8'),
      ],
      [
        'deploy-staging-local.sh',
        readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf8'),
      ],
    ] as const) {
      assert.ok(
        scriptContent.includes('source "$SCRIPT_DIR/lib/github-token.sh"'),
        `${scriptName} should source the shared GitHub token fallback helper`
      );
      assert.ok(
        scriptContent.includes('ensure_github_token_env'),
        `${scriptName} should populate GH_TOKEN from gh auth token when needed`
      );
    }
  });

  test('latest-only promotion helper tags only the live verified staging SHA', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
      'utf-8'
    );
    const packageJson = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');
    const workflow = readFileSync(promoteCurrentStagingWorkflowPath, 'utf-8');
    const preflight = readFileSync(promoteCurrentStagingPreflightPath, 'utf-8');

    assert.ok(packageJson.includes('"promote:current-staging"'));
    assert.ok(existsSync(promoteCurrentStagingPreflightPath));
    assert.ok(workflow.includes('contents: read'));
    assert.ok(workflow.includes('actions/create-github-app-token@v3'));
    assert.ok(workflow.includes('client-id: ${{ vars.CLASSROOMPATH_PROMOTION_APP_CLIENT_ID }}'));
    assert.ok(
      workflow.includes('private-key: ${{ secrets.CLASSROOMPATH_PROMOTION_APP_PRIVATE_KEY }}')
    );
    assert.ok(workflow.includes('permission-contents: write'));
    assert.ok(workflow.includes('permission-workflows: write'));
    assert.ok(workflow.includes('persist-credentials: false'));
    assert.ok(workflow.includes('STAGING_SSH_KEY_SECRET: ${{ secrets.STAGING_DEPLOY_SSH_KEY }}'));
    assert.ok(workflow.includes('DEPLOY_SSH_KEY_SECRET: ${{ secrets.DEPLOY_SSH_KEY }}'));
    assert.ok(workflow.includes('bash scripts/preflight-current-staging-promotion.sh'));
    assert.ok(
      workflow.includes('PROMOTION_TAG_PUSH_TOKEN: ${{ steps.promotion-app-token.outputs.token }}')
    );
    assert.ok(helper.includes('cat /srv/classroompath/release-state/current-images.env'));
    assert.ok(helper.includes('cat /srv/classroompath/release-state/staging-verification.env'));
    assert.ok(helper.includes('target_sha="$(read_env_value "$current_state_file" APP_SHA)"'));
    assert.ok(helper.includes('if [ "$target_sha" != "$verified_sha" ]; then'));
    assert.ok(helper.includes('STAGING_VERIFICATION_STATE=${verification_state:-unset}'));
    assert.ok(helper.includes('IMAGE_SOURCE=${current_image_source:-unset}'));
    assert.ok(helper.includes('STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}'));
    assert.ok(helper.includes('RC_RUN_ID="$(read_env_value "$current_state_file" RC_RUN_ID)"'));
    assert.ok(
      helper.includes('release-identity.env') &&
        helper.includes('--release-id "$RELEASE_ID"') &&
        helper.includes('--rc-run-id "$RC_RUN_ID"') &&
        helper.includes('--classroompath-sha "$CLASSROOMPATH_SHA"')
    );
    assert.ok(
      helper.includes(
        'TARGET_SHA="$target_sha" PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir"'
      ) && helper.includes('bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"')
    );
    assert.ok(helper.includes('promotion-evidence-cli.mjs'));
    assert.ok(helper.includes('git tag -a "$next_tag" "$target_sha" -F "$tag_message_file"'));
    assert.ok(helper.includes('PROMOTION_TAG_PUSH_TOKEN'));
    assert.ok(helper.includes('"refs/tags/$next_tag"'));
    assert.ok(helper.includes('git push origin "$next_tag"'));
    assert.ok(preflight.includes('cat /srv/classroompath/release-state/current-images.env'));
    assert.ok(preflight.includes('cat /srv/classroompath/release-state/staging-verification.env'));
    assert.ok(preflight.includes('"${PRODUCTION_SSH_CMD[@]}" "true"'));
    assert.ok(preflight.includes('if [ "$target_sha" != "$verified_sha" ]; then'));
    assert.ok(preflight.includes('STAGING_VERIFICATION_STATE=${verification_state:-unset}'));
    assert.ok(preflight.includes('IMAGE_SOURCE=${current_image_source:-unset}'));
    assert.ok(preflight.includes('STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}'));
  });

  test('promotion helper only reads fields emitted by the exact tag identity file', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
      'utf-8'
    );
    const identityCheckStart = helper.indexOf('if [ "$CLASSROOMPATH_SHA" != "$target_sha" ]; then');
    const productionPreflightStart = helper.indexOf(
      'log_info "Verifying production target readiness before tagging $next_tag..."'
    );
    assert.ok(identityCheckStart >= 0);
    assert.ok(productionPreflightStart > identityCheckStart);

    const identityCheck = helper.slice(identityCheckStart, productionPreflightStart);
    assert.match(identityCheck, /\[ "\$STAGING_RELEASE_ID" != "\$RELEASE_ID" \]/u);
    assert.match(identityCheck, /\[ "\$STAGING_RC_RUN_ID" != "\$RC_RUN_ID" \]/u);
    assert.doesNotMatch(identityCheck, /\$OPENPATH_SHA/u);
    assert.doesNotMatch(identityCheck, /\$OPENPATH_CONTRACT_SHA256/u);
  });

  test('GitHub token helper falls back to gh auth token when env tokens are absent', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-gh-token-'));
    const fakeBinDir = resolve(tempDir, 'bin');

    try {
      writeFileSync(resolve(tempDir, 'script.sh'), '');
      writeFileSync(resolve(tempDir, 'output.env'), '');
      writeFileSync(resolve(tempDir, 'err.log'), '');
      writeFileSync(resolve(tempDir, 'stdout.log'), '');
      writeFileSync(resolve(tempDir, 'status'), '');
      writeFileSync(resolve(tempDir, 'token'), 'fallback-token\n');
      writeFileSync(
        resolve(tempDir, 'common.sh'),
        readFileSync(resolve(projectRoot, 'scripts/lib/common.sh'), 'utf8')
      );
      writeFileSync(
        resolve(tempDir, 'github-token.sh'),
        readFileSync(resolve(projectRoot, 'scripts/lib/github-token.sh'), 'utf8')
      );
      execFileSync('mkdir', ['-p', fakeBinDir]);
      writeFileSync(
        resolve(fakeBinDir, 'gh'),
        `#!/usr/bin/env bash\nif [ "$1 $2" = "auth token" ]; then cat "${resolve(
          tempDir,
          'token'
        )}"; exit 0; fi\nexit 2\n`
      );
      chmodSync(resolve(fakeBinDir, 'gh'), 0o755);

      const output = execFileSync(
        'bash',
        [
          '-c',
          `set -euo pipefail; source "${resolve(tempDir, 'common.sh')}"; source "${resolve(
            tempDir,
            'github-token.sh'
          )}"; unset GH_TOKEN GITHUB_TOKEN; PATH="${fakeBinDir}:$PATH"; ensure_github_token_env; printf '%s' "$GH_TOKEN"`,
        ],
        { encoding: 'utf8' }
      );

      assert.equal(output, 'fallback-token');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
