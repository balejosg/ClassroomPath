import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const productionDeployScript = resolve(projectRoot, 'scripts/deploy-production-remote.sh');
const productionRollbackScript = resolve(projectRoot, 'scripts/rollback-production-remote.sh');
const previousReleaseFixtureDir = resolve(
  projectRoot,
  'tests/fixtures/production-remote-previous-release'
);
const productionRecoveryArtifactHelper = resolve(
  projectRoot,
  'scripts/lib/production-recovery-artifact.sh'
);
const diagnosticFallbackScript = resolve(
  projectRoot,
  'scripts/lib/production-deployment-diagnostic-fallback.sh'
);

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function runBash(path: string, env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [path], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
}

function runBashFromStdin(path: string, env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [], {
    cwd: projectRoot,
    env,
    input: readFileSync(path),
    encoding: 'utf8',
  });
}

function createFakeGit(binDir: string) {
  writeExecutable(
    join(binDir, 'git'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "\${TRACE_FILE:?}"
case "\${1:-}" in
  fetch|clean|submodule)
    exit 0
    ;;
  checkout)
    if [ "\${2:-}" = "--detach" ] && [ -n "\${CANDIDATE_LIB_DIR:-}" ]; then
      cp -R "\${CANDIDATE_LIB_DIR:?}/." "\${APP_DIR:?}/scripts/lib/"
    fi
    exit 0
    ;;
  reset)
    if [ -n "\${CANDIDATE_LIB_DIR:-}" ]; then
      cp -R "\${CANDIDATE_LIB_DIR:?}/." "\${APP_DIR:?}/scripts/lib/"
    fi
    exit 0
    ;;
  rev-parse)
    case "\${2:-}" in
      HEAD:upstream/openpath) printf '%s\\n' "\${OPENPATH_SHA:-\${TARGET_SHA:?}}" ;;
      HEAD) printf '%s\\n' "\${TARGET_SHA:?}" ;;
      origin/main|*'^{commit}') printf '%s\\n' "\${TARGET_SHA:?}" ;;
      *) printf '%s\\n' "\${TARGET_SHA:?}" ;;
    esac
    exit 0
    ;;
  cat-file)
    exit 0
    ;;
esac
exit 0
`
  );
}

function createFakeDocker(binDir: string, mode: 'bootstrap' | 'rollback') {
  const loginExit = mode === 'bootstrap' ? 42 : 0;
  writeExecutable(
    join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "\${CALLS_FILE:?}"
case "\${1:-}" in
  info)
    exit 0
    ;;
  login)
    exit ${loginExit}
    ;;
  logout|pull|rm)
    exit 0
    ;;
  create)
    printf 'fake-container\\n'
    exit 0
    ;;
  cp)
    destination="\${!#}"
    mkdir -p "$(dirname "$destination")"
    case "$destination" in
      *metadata.json) printf '%s\\n' '{"version":"fixture"}' > "$destination" ;;
      *openpath-firefox-extension.xpi) printf '%s\\n' 'fixture-xpi' > "$destination" ;;
    esac
    exit 0
    ;;
  compose)
    case "\${2:-}" in
      version|pull|up|down|ps)
        [ "\${2:-}" = ps ] && printf 'classroompath-gateway healthy\\n'
        exit 0
        ;;
    esac
    exit 0
    ;;
  run)
    state_root=""
    output_dir=""
    for argument in "$@"; do
      case "$argument" in
        *:/tmp/classroompath-release-state:rw) state_root="\${argument%:/tmp/classroompath-release-state:rw}" ;;
        *:/tmp/release-state-output:rw) output_dir="\${argument%:/tmp/release-state-output:rw}" ;;
      esac
    done
    if printf '%s' "$*" | grep -q 'release-bundle-state.mjs read '; then
      previous_id="$(tr -d '\\r\\n' < "\${state_root:?}/previous")"
      cp "\${state_root}/releases/\${previous_id}/runtime.env" "\${output_dir:?}/runtime.env"
      printf '{"releaseId":"%s"}\\n' "$previous_id"
    elif printf '%s' "$*" | grep -q 'release-bundle-state.mjs activate-previous '; then
      previous_id="$(tr -d '\\r\\n' < "\${state_root:?}/previous")"
      printf '%s\\n' "$previous_id" > "\${state_root}/current"
    fi
    exit 0
    ;;
esac
exit 0
`
  );
}

function createFakeCurl(binDir: string) {
  writeExecutable(
    join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
output_file=/dev/null
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    -w|--max-time|--max-filesize) shift 2 ;;
    -fsS|-sS|-f|-s|-S) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [[ "$url" == */cp/ready ]]; then
  printf '%s\\n' '{"ready":true}' > "$output_file"
  printf '200'
else
  printf '200'
fi
`
  );
}

function createRecoverySourceFixture(tempDir: string) {
  const sourceRoot = join(tempDir, 'recovery-source');
  cpSync(join(projectRoot, 'scripts'), join(sourceRoot, 'scripts'), { recursive: true });
  execFileSync('git', ['init', '--quiet', sourceRoot]);
  // Prevent detached Git housekeeping from racing with temporary fixture cleanup.
  execFileSync('git', ['-C', sourceRoot, 'config', 'gc.auto', '0']);
  execFileSync('git', ['-C', sourceRoot, 'config', 'maintenance.auto', 'false']);
  execFileSync('git', ['-C', sourceRoot, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', sourceRoot, 'config', 'user.name', 'Recovery Fixture']);
  execFileSync('git', ['-C', sourceRoot, 'add', 'scripts']);
  execFileSync('git', ['-C', sourceRoot, 'commit', '--quiet', '-m', 'recovery fixture']);
  const recoverySha = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return { sourceRoot, recoverySha };
}

test('recovery source fixtures disable automatic Git maintenance before cleanup', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-git-maintenance-'));

  try {
    const { sourceRoot } = createRecoverySourceFixture(tempDir);
    const gcAuto = spawnSync('git', ['-C', sourceRoot, 'config', '--get', 'gc.auto'], {
      encoding: 'utf8',
    });
    const maintenanceAuto = spawnSync(
      'git',
      ['-C', sourceRoot, 'config', '--get', 'maintenance.auto'],
      { encoding: 'utf8' }
    );

    assert.equal(gcAuto.status, 0);
    assert.equal(gcAuto.stdout.trim(), '0');
    assert.equal(maintenanceAuto.status, 0);
    assert.equal(maintenanceAuto.stdout.trim(), 'false');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function packageRecoverySourceFixture(sourceRoot: string, recoverySha: string, bundlePath: string) {
  execFileSync(
    'bash',
    [join(sourceRoot, 'scripts/package-production-recovery-bundle.sh'), bundlePath],
    {
      cwd: sourceRoot,
      env: { ...process.env, PRODUCTION_RECOVERY_SHA: recoverySha },
    }
  );
}

function createPreviousRuntime(releaseId: string) {
  return [
    `RELEASE_ID=${releaseId}`,
    'RC_RUN_ID=123',
    `APP_SHA=${'2'.repeat(40)}`,
    `OPENPATH_SHA=${'3'.repeat(40)}`,
    `OPENPATH_CONTRACT_SHA256=${'4'.repeat(64)}`,
    'IMAGE_SOURCE=release-candidate',
    `CLASSROOMPATH_GATEWAY_IMAGE=ghcr.io/example/gateway@sha256:${'5'.repeat(64)}`,
    `CLASSROOMPATH_MIGRATIONS_IMAGE=ghcr.io/example/migrations@sha256:${'6'.repeat(64)}`,
    `OPENPATH_FIREFOX_ASSETS_IMAGE=ghcr.io/example/firefox@sha256:${'7'.repeat(64)}`,
    `OPENPATH_API_IMAGE=ghcr.io/example/api@sha256:${'8'.repeat(64)}`,
    'OPENPATH_VERSION=4.1.19',
    'OPENPATH_LINUX_AGENT_VERSION=4.1.19',
    'OPENPATH_LINUX_AGENT_APT_SUITE=stable',
    `CLASSROOMPATH_SPA_IMAGE=ghcr.io/example/spa@sha256:${'9'.repeat(64)}`,
    `CLASSROOMPATH_VERIFIER_IMAGE=ghcr.io/example/verifier@sha256:${'a'.repeat(64)}`,
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=4.1.0',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=template-commit',
    'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG=scripts-v4.1.0',
    `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=${'b'.repeat(64)}`,
    '',
  ].join('\n');
}

function createPreviousReleaseFixture(appDir: string) {
  assert.ok(
    existsSync(previousReleaseFixtureDir),
    'the N→N+1 predecessor must be a tracked versioned fixture, not derived from HEAD^'
  );
  cpSync(previousReleaseFixtureDir, appDir, { recursive: true });
}

test('real production bootstrap reaches checkout and post-checkout preflight from a previous-release tree', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-production-bootstrap-'));
  const deployRoot = join(tempDir, 'deploy');
  const appDir = join(deployRoot, 'app');
  const streamedDir = join(tempDir, 'streamed', 'scripts');
  const binDir = join(tempDir, 'bin');
  const traceFile = join(tempDir, 'trace.log');
  const targetSha = '1'.repeat(40);
  const manifest = Buffer.from('run_id=123\n', 'utf8').toString('base64');
  const payload = Buffer.from(
    [
      `deploy_sha=${targetSha}`,
      'image_source=release-candidate',
      'deployment_mode=promotion-eligible',
      `manifest_base64=${manifest}`,
      `release_id=${'c'.repeat(64)}`,
      'rc_run_id=123',
      `release_bundle_base64=${Buffer.from('fixture-bundle', 'utf8').toString('base64')}`,
      `openpath_contract_base64=${Buffer.from('fixture-contract', 'utf8').toString('base64')}`,
      '',
    ].join('\n'),
    'utf8'
  ).toString('base64');

  mkdirSync(appDir, { recursive: true });
  mkdirSync(streamedDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  createPreviousReleaseFixture(appDir);
  assert.equal(
    existsSync(join(appDir, 'scripts/lib/production-host-contract.sh')),
    false,
    'previous release must not contain the candidate host-contract helper'
  );
  assert.doesNotMatch(
    readFileSync(join(appDir, 'scripts/lib/remote-deploy-scaffold.sh'), 'utf8'),
    /PRODUCTION_HOST_CONTRACT_HELPER_PATH|DEPLOYMENT_TRANSACTION_HELPER_PATH|ROLLBACK_EXECUTOR_HELPER_PATH/u
  );
  assert.doesNotMatch(
    readFileSync(join(appDir, 'scripts/lib/remote-helper-contracts.sh'), 'utf8'),
    /production_host_contract_helper_supports_contract|deployment_transaction_helper_supports_contract|rollback_executor_helper_supports_contract/u
  );
  cpSync(productionDeployScript, join(streamedDir, 'deploy-production-remote.sh'));
  chmodSync(join(streamedDir, 'deploy-production-remote.sh'), 0o755);
  createFakeGit(binDir);
  createFakeDocker(binDir, 'bootstrap');

  try {
    const result = runBash(join(streamedDir, 'deploy-production-remote.sh'), {
      ...process.env,
      APP_DIR: appDir,
      CALLS_FILE: traceFile,
      CANDIDATE_LIB_DIR: resolve(projectRoot, 'scripts/lib'),
      CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
      DEPLOY_PAYLOAD_B64: payload,
      GHCR_TOKEN: 'fixture-token',
      GHCR_USERNAME: 'fixture-user',
      PATH: `${binDir}:/usr/bin:/bin`,
      PRODUCTION_HOST_NETWORK_CHECK_COMMAND: 'true',
      TARGET_SHA: targetSha,
      TRACE_FILE: traceFile,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const trace = existsSync(traceFile) ? readFileSync(traceFile, 'utf8') : '';

    assert.notEqual(result.status, 0, 'fixture must stop before registry/payload side effects');
    assert.match(trace, /git checkout --detach/u, `${output}\n${trace}`);
    assert.match(output, /Production host contract passed/u);
    assert.doesNotMatch(
      output,
      /production-host-contract helper does not meet|deployment-transaction helper does not meet|rollback-executor helper does not meet/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('real rollback entrypoint restores the previous release with candidate helpers removed', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-production-recovery-'));
  const deployRoot = join(tempDir, 'deploy');
  const appDir = join(deployRoot, 'app');
  const streamedDir = join(tempDir, 'streamed');
  const binDir = join(tempDir, 'bin');
  const traceFile = join(tempDir, 'git-trace.log');
  const candidateHelperTraceFile = join(tempDir, 'candidate-helper-read.log');
  const callsFile = join(tempDir, 'calls.log');
  const bundlePath = join(tempDir, 'recovery.tgz');
  const previousId = 'a'.repeat(64);
  const currentId = 'c'.repeat(64);
  const candidateSha = '2'.repeat(40);
  const { sourceRoot: recoverySourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);
  const candidateHelperNames = [
    'common.sh',
    'remote-bootstrap.sh',
    'remote-deploy-scaffold.sh',
    'remote-helper-contracts.sh',
    'release-state.sh',
    'release-runtime.sh',
    'deployment-state.sh',
    'production-host-contract.sh',
    'deployment-transaction.sh',
    'rollback-executor.sh',
    'rollback-readiness.sh',
    'production-recovery-executor.sh',
    'deploy-container-platform.sh',
  ];

  mkdirSync(join(appDir, 'scripts/lib'), { recursive: true });
  mkdirSync(join(appDir, 'config'), { recursive: true });
  mkdirSync(join(appDir, 'docker'), { recursive: true });
  mkdirSync(join(appDir, 'upstream/openpath'), { recursive: true });
  mkdirSync(join(deployRoot, 'release-state/releases', previousId), { recursive: true });
  mkdirSync(streamedDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(appDir, 'config/.env'), 'SENTINEL=before-rollback\n', 'utf8');
  writeFileSync(join(appDir, 'docker/docker-compose.yml'), 'services: {}\n', 'utf8');
  writeFileSync(join(deployRoot, 'release-state/previous'), `${previousId}\n`, 'utf8');
  writeFileSync(join(deployRoot, 'release-state/current'), `${currentId}\n`, 'utf8');
  writeFileSync(
    join(deployRoot, 'release-state/deployment-phase.env'),
    [
      'DEPLOYMENT_TRANSACTION_VERSION=1',
      'DEPLOYMENT_PHASE=FAILED',
      'DEPLOYMENT_STAGE=VERIFY',
      'MUTATION_BOUNDARY_REACHED=1',
      `CANDIDATE_SHA=${candidateSha}`,
      `CURRENT_RELEASE_ID=${currentId}`,
      `CANDIDATE_RELEASE_ID=${currentId}`,
      `PREVIOUS_RELEASE_ID=${previousId}`,
      'ROLLBACK_ATTEMPTED=0',
      'ROLLBACK_RESULT=not_attempted',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    join(deployRoot, 'release-state/releases', previousId, 'runtime.env'),
    createPreviousRuntime(previousId),
    'utf8'
  );
  for (const helperName of candidateHelperNames) {
    writeExecutable(
      join(appDir, 'scripts/lib', helperName),
      `#!/usr/bin/env bash\nprintf '%s\\n' '${helperName}' >> "$CANDIDATE_HELPER_TRACE_FILE"\nreturn 97\n`
    );
  }
  writeExecutable(
    join(appDir, 'scripts/package-production-recovery-bundle.sh'),
    `#!/usr/bin/env bash
printf '%s\n' package-production-recovery-bundle.sh >> "$CANDIDATE_HELPER_TRACE_FILE"
exit 97
`
  );
  cpSync(productionRollbackScript, join(streamedDir, 'rollback-production-remote.sh'));
  chmodSync(join(streamedDir, 'rollback-production-remote.sh'), 0o755);
  createFakeGit(binDir);
  createFakeDocker(binDir, 'rollback');
  createFakeCurl(binDir);
  packageRecoverySourceFixture(recoverySourceRoot, recoverySha, bundlePath);
  const artifactSha256 = execFileSync('sha256sum', [bundlePath], { encoding: 'utf8' })
    .trim()
    .split(/\s+/u)[0];
  const executorSha256 = createHash('sha256')
    .update(execFileSync('tar', ['-xOf', bundlePath, 'production-recovery-executor.sh']))
    .digest('hex');
  const transactionPath = join(deployRoot, 'release-state/deployment-phase.env');
  writeFileSync(
    transactionPath,
    `${readFileSync(transactionPath, 'utf8')}RECOVERY_ARTIFACT_SHA256=${artifactSha256}\n`,
    'utf8'
  );
  const durableArtifactPath = join(
    deployRoot,
    'recovery/releases',
    artifactSha256,
    'production-recovery-bundle.tgz'
  );
  mkdirSync(join(deployRoot, 'recovery/releases', artifactSha256), { recursive: true });
  cpSync(bundlePath, durableArtifactPath);
  writeFileSync(
    join(deployRoot, 'recovery/current-artifact.env'),
    [
      'PRODUCTION_RECOVERY_ARTIFACT_VERSION=1',
      `PRODUCTION_RECOVERY_ARTIFACT_SHA256=${artifactSha256}`,
      `PRODUCTION_RECOVERY_EXECUTOR_SHA256=${executorSha256}`,
      `PRODUCTION_RECOVERY_ARTIFACT_PATH=${durableArtifactPath}`,
      `PRODUCTION_RECOVERY_SHA=${recoverySha}`,
      `PRODUCTION_RECOVERY_SOURCE_SHA=${recoverySha}`,
      'PRODUCTION_RECOVERY_SOURCE_VERSION=1',
      'PRODUCTION_RECOVERY_CONTRACT_VERSION=1',
      `PRODUCTION_RECOVERY_CANDIDATE_SHA=${candidateSha}`,
      'PRODUCTION_RECOVERY_PREFLIGHT=passed',
      '',
    ].join('\n'),
    'utf8'
  );

  try {
    const result = runBashFromStdin(join(streamedDir, 'rollback-production-remote.sh'), {
      ...process.env,
      APP_DIR: appDir,
      CALLS_FILE: callsFile,
      CANDIDATE_HELPER_TRACE_FILE: candidateHelperTraceFile,
      CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
      GHCR_TOKEN: 'fixture-token',
      GHCR_USERNAME: 'fixture-user',
      OPENPATH_FIREFOX_RELEASE_HOST_ROOT: join(deployRoot, 'firefox-release'),
      OPENPATH_SHA: '3'.repeat(40),
      PATH: `${binDir}:/usr/bin:/bin`,
      PRODUCTION_CONTAINER_PLATFORM: 'linux/amd64',
      PRODUCTION_HOST_NETWORK_CHECK_COMMAND: 'true',
      CANDIDATE_SHA: candidateSha,
      PRODUCTION_RECOVERY_ARTIFACT_SHA256: artifactSha256,
      PRODUCTION_RECOVERY_EXECUTOR_SHA256: executorSha256,
      PRODUCTION_RECOVERY_SHA: recoverySha,
      PRODUCTION_RECOVERY_SOURCE_SHA: recoverySha,
      PRODUCTION_RECOVERY_SOURCE_VERSION: '1',
      PRODUCTION_RECOVERY_CONTRACT_VERSION: '1',
      PRODUCTION_ROLLBACK_CURL_TIMEOUT_SECONDS: '1',
      PRODUCTION_ROLLBACK_PUBLIC_URL: 'http://localhost:3001',
      PRODUCTION_ROLLBACK_READINESS_ATTEMPTS: '1',
      PRODUCTION_ROLLBACK_READINESS_DELAY_SECONDS: '0',
      TARGET_SHA: candidateSha,
      TRACE_FILE: traceFile,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const currentPointer = readFileSync(join(deployRoot, 'release-state/current'), 'utf8').trim();

    assert.equal(
      result.status,
      0,
      `${output}\n${existsSync(callsFile) ? readFileSync(callsFile, 'utf8') : ''}`
    );
    assert.equal(currentPointer, previousId);
    assert.match(output, /Rollback health and readiness checks passed/u);
    assert.ok(!existsSync(candidateHelperTraceFile), 'candidate helper code must not be sourced');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('real rollback rejects transmitted bytes that differ from the persisted R artifact', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-byte-mismatch-'));
  const deployRoot = join(tempDir, 'deploy');
  const appDir = join(deployRoot, 'app');
  const streamedDir = join(tempDir, 'streamed');
  const bundlePath = join(tempDir, 'recovery.tgz');
  const previousId = 'a'.repeat(64);
  const candidateSha = '2'.repeat(40);
  const { sourceRoot: recoverySourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);

  mkdirSync(join(appDir, 'scripts'), { recursive: true });
  mkdirSync(streamedDir, { recursive: true });
  packageRecoverySourceFixture(recoverySourceRoot, recoverySha, bundlePath);
  const artifactSha256 = execFileSync('sha256sum', [bundlePath], { encoding: 'utf8' })
    .trim()
    .split(/\s+/u)[0];
  const executorSha256 = createHash('sha256')
    .update(execFileSync('tar', ['-xOf', bundlePath, 'production-recovery-executor.sh']))
    .digest('hex');
  const durableArtifactPath = join(
    deployRoot,
    'recovery/releases',
    artifactSha256,
    'production-recovery-bundle.tgz'
  );
  mkdirSync(join(deployRoot, 'recovery/releases', artifactSha256), { recursive: true });
  cpSync(bundlePath, durableArtifactPath);
  const identityPath = join(deployRoot, 'recovery/current-artifact.env');
  const identity = [
    'PRODUCTION_RECOVERY_ARTIFACT_VERSION=1',
    `PRODUCTION_RECOVERY_SHA=${recoverySha}`,
    `PRODUCTION_RECOVERY_ARTIFACT_SHA256=${artifactSha256}`,
    `PRODUCTION_RECOVERY_EXECUTOR_SHA256=${executorSha256}`,
    `PRODUCTION_RECOVERY_ARTIFACT_PATH=${durableArtifactPath}`,
    `PRODUCTION_RECOVERY_SOURCE_SHA=${recoverySha}`,
    'PRODUCTION_RECOVERY_SOURCE_VERSION=1',
    'PRODUCTION_RECOVERY_CONTRACT_VERSION=1',
    `PRODUCTION_RECOVERY_CANDIDATE_SHA=${candidateSha}`,
    'PRODUCTION_RECOVERY_PREFLIGHT=passed',
    '',
  ].join('\n');
  writeFileSync(identityPath, identity, 'utf8');
  cpSync(productionRollbackScript, join(streamedDir, 'rollback-production-remote.sh'));

  try {
    const alteredBytes = Buffer.concat([readFileSync(bundlePath), Buffer.from('\n', 'utf8')]);
    const result = runBashFromStdin(join(streamedDir, 'rollback-production-remote.sh'), {
      ...process.env,
      APP_DIR: appDir,
      CANDIDATE_SHA: candidateSha,
      CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
      PATH: '/usr/bin:/bin',
      PRODUCTION_RECOVERY_BUNDLE_B64: alteredBytes.toString('base64'),
      PRODUCTION_RECOVERY_ARTIFACT_SHA256: artifactSha256,
      PRODUCTION_RECOVERY_EXECUTOR_SHA256: executorSha256,
      PRODUCTION_RECOVERY_SHA: recoverySha,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(
      output,
      /Transmitted recovery bytes do not match the persisted recovery artifact/u
    );
    assert.equal(readFileSync(identityPath, 'utf8'), identity);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('exact recovery bytes are preflighted and persisted before the mutation boundary', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-artifact-'));
  const deployRoot = join(tempDir, 'deploy');
  const appDir = join(deployRoot, 'app');
  const binDir = join(tempDir, 'bin');
  const callsFile = join(tempDir, 'calls.log');
  const candidateHelperTraceFile = join(tempDir, 'candidate-helper-read.log');
  const bundlePath = join(tempDir, 'recovery.tgz');
  const previousId = 'a'.repeat(64);
  const candidateSha = '2'.repeat(40);
  const { sourceRoot: recoverySourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);

  mkdirSync(join(appDir, 'scripts/lib'), { recursive: true });
  mkdirSync(join(deployRoot, 'release-state/releases', previousId), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(deployRoot, 'release-state/previous'), `${previousId}\n`, 'utf8');
  writeFileSync(join(deployRoot, 'release-state/current'), `${previousId}\n`, 'utf8');
  writeFileSync(
    join(deployRoot, 'release-state/deployment-phase.env'),
    [
      'DEPLOYMENT_TRANSACTION_VERSION=1',
      'DEPLOYMENT_PHASE=PREPARED',
      'DEPLOYMENT_STAGE=PREFLIGHT',
      'MUTATION_BOUNDARY_REACHED=0',
      `CANDIDATE_SHA=${candidateSha}`,
      `CURRENT_RELEASE_ID=${previousId}`,
      `PREVIOUS_RELEASE_ID=${previousId}`,
      'ROLLBACK_ATTEMPTED=0',
      'ROLLBACK_RESULT=not_attempted',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    join(deployRoot, 'release-state/releases', previousId, 'runtime.env'),
    createPreviousRuntime(previousId),
    'utf8'
  );
  writeExecutable(
    join(appDir, 'scripts/lib/common.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' candidate >> "\${CANDIDATE_HELPER_TRACE_FILE:?}"\nreturn 97\n`
  );
  createFakeDocker(binDir, 'rollback');
  packageRecoverySourceFixture(recoverySourceRoot, recoverySha, bundlePath);
  const artifactSha256 = execFileSync('sha256sum', [bundlePath], { encoding: 'utf8' })
    .trim()
    .split(/\s+/u)[0];
  const executorSha256 = createHash('sha256')
    .update(execFileSync('tar', ['-xOf', bundlePath, 'production-recovery-executor.sh']))
    .digest('hex');

  const shellScript = [
    'set -euo pipefail',
    'source "$1"',
    'source "$2"',
    'source "$4"',
    'deployment_state_init_paths "$3/release-state"',
    'DEPLOYMENT_TRANSACTION_FILE="$3/release-state/deployment-phase.env"',
    'export DEPLOYMENT_TRANSACTION_FILE',
    'set -a; . "$DEPLOYMENT_TRANSACTION_FILE"; set +a',
    'DEPLOYMENT_STATE_USE_VERIFIER=1',
    'export DEPLOYMENT_STATE_USE_VERIFIER',
    'production_recovery_artifact_prepare',
  ].join('\n');

  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        shellScript,
        'recovery-artifact-test',
        productionRecoveryArtifactHelper,
        resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
        deployRoot,
        resolve(projectRoot, 'scripts/lib/deployment-state.sh'),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_DIR: appDir,
          CALLS_FILE: callsFile,
          CANDIDATE_HELPER_TRACE_FILE: candidateHelperTraceFile,
          CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
          CANDIDATE_SHA: candidateSha,
          PATH: `${binDir}:/usr/bin:/bin`,
          PRODUCTION_HOST_NETWORK_CHECK_COMMAND: 'true',
          PRODUCTION_RECOVERY_ARTIFACT_SHA256: artifactSha256,
          PRODUCTION_RECOVERY_BUNDLE_B64: readFileSync(bundlePath).toString('base64'),
          PRODUCTION_RECOVERY_EXECUTOR_SHA256: executorSha256,
          PRODUCTION_RECOVERY_SHA: recoverySha,
          PRODUCTION_RECOVERY_SOURCE_SHA: recoverySha,
          PRODUCTION_RECOVERY_SOURCE_VERSION: '1',
          PRODUCTION_RECOVERY_CONTRACT_VERSION: '1',
        },
      }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const identityPath = join(deployRoot, 'recovery/current-artifact.env');
    const persistedArchive = join(
      deployRoot,
      'recovery/releases',
      artifactSha256,
      'production-recovery-bundle.tgz'
    );
    const transaction = readFileSync(
      join(deployRoot, 'release-state/deployment-phase.env'),
      'utf8'
    );
    const rollbackPlan = readFileSync(join(deployRoot, 'release-state/rollback-plan.env'), 'utf8');

    assert.match(
      readFileSync(identityPath, 'utf8'),
      new RegExp(`PRODUCTION_RECOVERY_ARTIFACT_SHA256=${artifactSha256}`, 'u')
    );
    assert.match(
      readFileSync(identityPath, 'utf8'),
      new RegExp(`PRODUCTION_RECOVERY_EXECUTOR_SHA256=${executorSha256}`, 'u')
    );
    assert.match(readFileSync(identityPath, 'utf8'), /PRODUCTION_RECOVERY_PREFLIGHT=passed/u);
    assert.match(
      readFileSync(identityPath, 'utf8'),
      new RegExp(`PRODUCTION_RECOVERY_SOURCE_SHA=${recoverySha}`, 'u')
    );
    assert.match(
      readFileSync(identityPath, 'utf8'),
      new RegExp(`PRODUCTION_RECOVERY_SHA=${recoverySha}`, 'u')
    );
    assert.match(readFileSync(identityPath, 'utf8'), /PRODUCTION_RECOVERY_SOURCE_VERSION=1/u);
    assert.match(readFileSync(identityPath, 'utf8'), /PRODUCTION_RECOVERY_CONTRACT_VERSION=1/u);
    assert.equal(readFileSync(persistedArchive).equals(readFileSync(bundlePath)), true);
    assert.match(transaction, /^MUTATION_BOUNDARY_REACHED=0$/mu);
    assert.match(transaction, new RegExp(`CANDIDATE_SHA=${candidateSha}`, 'u'));
    assert.match(transaction, new RegExp(`RECOVERY_SOURCE_SHA=${recoverySha}`, 'u'));
    assert.match(transaction, /RECOVERY_CONTRACT_VERSION=1/u);
    assert.match(transaction, new RegExp(`RECOVERY_ARTIFACT_SHA256=${artifactSha256}`, 'u'));
    assert.match(
      rollbackPlan,
      new RegExp(`ROLLBACK_RECOVERY_ARTIFACT_SHA256=${artifactSha256}`, 'u')
    );
    assert.equal(
      existsSync(candidateHelperTraceFile),
      false,
      'recovery preflight must not read executable code from APP_DIR'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('recovery artifact fault injection fails closed before persistence or mutation', () => {
  const scenarios = [
    {
      name: 'hash-mismatch',
      expectedHash: 'f'.repeat(64),
      bundle: 'complete',
      pointer: true,
      failure: /hash mismatch/u,
    },
    {
      name: 'executor-hash-mismatch',
      expectedHash: '',
      bundle: 'complete',
      pointer: true,
      failure: /recovery executor hash mismatch/u,
    },
    {
      name: 'incomplete-package',
      expectedHash: '',
      bundle: 'incomplete',
      pointer: true,
      failure: /incomplete/u,
    },
    {
      name: 'missing-previous-pointer',
      expectedHash: '',
      bundle: 'complete',
      pointer: false,
      failure: /Release state file not found/u,
    },
    {
      name: 'source-sha-mismatch',
      expectedHash: '',
      bundle: 'complete',
      pointer: true,
      sourceSha: 'b'.repeat(40),
      failure: /must match PRODUCTION_RECOVERY_SHA/u,
    },
    {
      name: 'contract-version-mismatch',
      expectedHash: '',
      bundle: 'complete',
      pointer: true,
      contractVersion: '99',
      failure: /contract\/version is missing or incompatible/u,
    },
  ] as const;

  for (const scenario of scenarios) {
    const tempDir = mkdtempSync(join(tmpdir(), `classroompath-recovery-fault-${scenario.name}-`));
    const deployRoot = join(tempDir, 'deploy');
    const appDir = join(deployRoot, 'app');
    const binDir = join(tempDir, 'bin');
    const bundlePath = join(tempDir, 'recovery.tgz');
    const previousId = 'a'.repeat(64);
    const candidateSha = '2'.repeat(40);
    const { sourceRoot: recoverySourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);

    mkdirSync(join(appDir, 'scripts/lib'), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(deployRoot, 'release-state'), { recursive: true });
    createFakeDocker(binDir, 'rollback');
    writeFileSync(
      join(deployRoot, 'release-state/deployment-phase.env'),
      [
        'DEPLOYMENT_TRANSACTION_VERSION=1',
        'DEPLOYMENT_PHASE=PREPARED',
        'DEPLOYMENT_STAGE=PREFLIGHT',
        'MUTATION_BOUNDARY_REACHED=0',
        `CANDIDATE_SHA=${candidateSha}`,
        '',
      ].join('\n'),
      'utf8'
    );
    if (scenario.pointer) {
      mkdirSync(join(deployRoot, 'release-state/releases', previousId), { recursive: true });
      writeFileSync(join(deployRoot, 'release-state/previous'), `${previousId}\n`, 'utf8');
      writeFileSync(join(deployRoot, 'release-state/current'), `${previousId}\n`, 'utf8');
      writeFileSync(
        join(deployRoot, 'release-state/releases', previousId, 'runtime.env'),
        createPreviousRuntime(previousId),
        'utf8'
      );
    }

    if (scenario.bundle === 'complete') {
      packageRecoverySourceFixture(recoverySourceRoot, recoverySha, bundlePath);
    } else {
      const incompleteRoot = join(tempDir, 'incomplete');
      mkdirSync(incompleteRoot, { recursive: true });
      writeExecutable(
        join(incompleteRoot, 'production-recovery-executor.sh'),
        '#!/usr/bin/env bash\nexit 0\n'
      );
      execFileSync(
        'tar',
        ['-czf', bundlePath, '-C', incompleteRoot, 'production-recovery-executor.sh'],
        { cwd: projectRoot }
      );
    }

    const actualHash = execFileSync('sha256sum', [bundlePath], { encoding: 'utf8' })
      .trim()
      .split(/\s+/u)[0];
    const expectedHash = scenario.expectedHash || actualHash;
    const actualExecutorHash =
      scenario.bundle === 'complete'
        ? createHash('sha256')
            .update(execFileSync('tar', ['-xOf', bundlePath, 'production-recovery-executor.sh']))
            .digest('hex')
        : 'f'.repeat(64);
    const expectedExecutorHash =
      scenario.name === 'executor-hash-mismatch' ? 'f'.repeat(64) : actualExecutorHash;
    const shellScript = [
      'set -euo pipefail',
      'source "$1"',
      'source "$2"',
      'source "$4"',
      'deployment_state_init_paths "$3/release-state"',
      'DEPLOYMENT_TRANSACTION_FILE="$3/release-state/deployment-phase.env"',
      'export DEPLOYMENT_TRANSACTION_FILE',
      'set -a; . "$DEPLOYMENT_TRANSACTION_FILE"; set +a',
      'DEPLOYMENT_STATE_USE_VERIFIER=1',
      'export DEPLOYMENT_STATE_USE_VERIFIER',
      'production_recovery_artifact_prepare',
    ].join('\n');

    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          shellScript,
          'recovery-artifact-fault-test',
          productionRecoveryArtifactHelper,
          resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
          deployRoot,
          resolve(projectRoot, 'scripts/lib/deployment-state.sh'),
        ],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            APP_DIR: appDir,
            CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
            PATH: `${binDir}:/usr/bin:/bin`,
            PRODUCTION_HOST_NETWORK_CHECK_COMMAND: 'true',
            CANDIDATE_SHA: candidateSha,
            PRODUCTION_RECOVERY_ARTIFACT_SHA256: expectedHash,
            PRODUCTION_RECOVERY_BUNDLE_B64: readFileSync(bundlePath).toString('base64'),
            PRODUCTION_RECOVERY_EXECUTOR_SHA256: expectedExecutorHash,
            PRODUCTION_RECOVERY_SHA: recoverySha,
            PRODUCTION_RECOVERY_SOURCE_SHA:
              ('sourceSha' in scenario && scenario.sourceSha) || recoverySha,
            PRODUCTION_RECOVERY_SOURCE_VERSION: '1',
            PRODUCTION_RECOVERY_CONTRACT_VERSION:
              ('contractVersion' in scenario && scenario.contractVersion) || '1',
          },
        }
      );

      assert.notEqual(result.status, 0, `${scenario.name} unexpectedly succeeded`);
      assert.match(`${result.stdout}\n${result.stderr}`, scenario.failure, scenario.name);
      assert.match(
        readFileSync(join(deployRoot, 'release-state/deployment-phase.env'), 'utf8'),
        /^MUTATION_BOUNDARY_REACHED=0$/mu,
        scenario.name
      );
      assert.equal(
        existsSync(join(deployRoot, 'recovery/current-artifact.env')),
        false,
        `${scenario.name} must not persist recovery identity`
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('minimal post-switch diagnostic preserves a durable mutation marker', () => {
  assert.ok(existsSync(diagnosticFallbackScript));
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-post-switch-diagnostic-'));
  const stateFile = join(tempDir, 'deployment-phase.env');
  const outputFile = join(tempDir, 'diagnostic.json');

  try {
    writeFileSync(
      stateFile,
      'DEPLOYMENT_PHASE=FAILED\nMUTATION_BOUNDARY_REACHED=1\nDEPLOYMENT_STAGE=VERIFY\n',
      'utf8'
    );
    const result = spawnSync('bash', [diagnosticFallbackScript, stateFile, outputFile], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const diagnostic = JSON.parse(readFileSync(outputFile, 'utf8')) as Record<string, unknown>;
    assert.equal(diagnostic.mutation_boundary_reached, true);
    assert.equal(diagnostic.deploymentPhase, 'FAILED');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('post-switch diagnostic selection falls back for missing, failing, or stale candidate diagnostics', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-diagnostic-selection-'));
  const stateFile = join(tempDir, 'deployment-phase.env');
  const outputFile = join(tempDir, 'diagnostic.json');
  const candidatePath = join(tempDir, 'app', 'scripts', 'production-deployment-diagnostic.sh');
  const fallbackPath = join(tempDir, 'stable', 'production-deployment-diagnostic-fallback.sh');

  mkdirSync(join(tempDir, 'app', 'scripts'), { recursive: true });
  mkdirSync(join(tempDir, 'stable'), { recursive: true });
  const fallbackTracePath = join(tempDir, 'fallback-invocations.log');
  writeExecutable(
    fallbackPath,
    `#!/usr/bin/env bash
printf '%s\\n' invoked >> "\${FALLBACK_TRACE_FILE:?}"
exec bash ${JSON.stringify(diagnosticFallbackScript)} "$@"
`
  );

  const selector = String.raw`set +e
state_file="$1"
diagnostic_path="$2"
candidate_path="$3"
fallback_path="$4"
mutation_boundary_reached="$(grep '^MUTATION_BOUNDARY_REACHED=' "$state_file" 2>/dev/null | sed 's/^[^=]*=//')"
expected_marker='"mutation_boundary_reached":false'
if [ "$mutation_boundary_reached" = 1 ]; then
  expected_marker='"mutation_boundary_reached":true'
fi
rm -f "$diagnostic_path"
diagnostic_status=1
candidate_diagnostic_valid=0
if [ "$mutation_boundary_reached" = 1 ] && [ -x "$candidate_path" ]; then
  if bash "$candidate_path" "$state_file" "$diagnostic_path"; then
    diagnostic_status=0
    if [ -s "$diagnostic_path" ] && grep -Fq "$expected_marker" "$diagnostic_path"; then
      candidate_diagnostic_valid=1
    fi
  else
    diagnostic_status=$?
  fi
fi
if [ "$candidate_diagnostic_valid" -ne 1 ]; then
  bash "$fallback_path" "$state_file" "$diagnostic_path" || true
fi
if [ -s "$diagnostic_path" ]; then
  cat "$diagnostic_path"
else
  bash "$fallback_path" "$state_file" "$diagnostic_path" && cat "$diagnostic_path"
fi
rm -f "$diagnostic_path"`;

  try {
    for (const scenario of [
      {
        name: 'missing',
        marker: '1',
        candidate: null,
        existingOutput: '{"mutation_boundary_reached":true,"mode":"stale"}\n',
      },
      {
        name: 'failing',
        marker: '1',
        candidate: '#!/usr/bin/env bash\nexit 73\n',
      },
      {
        name: 'stale',
        marker: '1',
        candidate:
          '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"mutation_boundary_reached":false}\' > "$2"\n',
      },
      {
        name: 'candidate-success',
        marker: '1',
        candidate:
          '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"mutation_boundary_reached":true,"mode":"candidate-rich"}\' > "$2"\n',
      },
      { name: 'pre-switch', marker: '0', candidate: null },
      {
        name: 'pre-switch-stale',
        marker: '0',
        candidate:
          '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"mutation_boundary_reached":true}\' > "$2"\n',
      },
    ]) {
      writeFileSync(
        stateFile,
        `DEPLOYMENT_PHASE=FAILED\nMUTATION_BOUNDARY_REACHED=${scenario.marker}\nDEPLOYMENT_STAGE=VERIFY\n`,
        'utf8'
      );
      rmSync(candidatePath, { force: true });
      rmSync(fallbackTracePath, { force: true });
      if (scenario.candidate) writeExecutable(candidatePath, scenario.candidate);
      if (scenario.existingOutput) writeFileSync(outputFile, scenario.existingOutput, 'utf8');

      const result = spawnSync(
        'bash',
        ['-c', selector, 'diagnostic-selector', stateFile, outputFile, candidatePath, fallbackPath],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          env: { ...process.env, FALLBACK_TRACE_FILE: fallbackTracePath },
        }
      );
      assert.equal(result.status, 0, `${scenario.name}: ${result.stdout}\n${result.stderr}`);
      const diagnostic = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(diagnostic.mutation_boundary_reached, scenario.marker === '1', scenario.name);
      if (scenario.marker === '1' && scenario.name !== 'candidate-success') {
        assert.equal(diagnostic.mode, 'minimal-post-switch-diagnostic', scenario.name);
      }
      if (scenario.name === 'candidate-success') {
        assert.equal(diagnostic.mode, 'candidate-rich');
        assert.equal(
          existsSync(fallbackTracePath),
          false,
          'fallback must not execute when the candidate diagnostic is successful and current'
        );
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
