import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { parseReleaseStateText } from './release-state-contract.mjs';

const CANARY_ARTIFACT_NAME = 'production-windows-ajax-auto-allow-canary.json';
const DEFAULT_OPENPATH_ROOT = '../OpenPath';
const DEFAULT_STAGING_VERIFICATION_PATH =
  '/opt/classroompath/release-state/staging-verification.env';
const DIRECT_WINDOWS_COMMAND = 'npm run diagnostics:windows-ajax:direct -- --environment staging';

function valueOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shellQuote(value) {
  const text = String(value ?? '');
  return /^[A-Za-z0-9_./:@=+-]+$/u.test(text) ? text : `'${text.replace(/'/g, `'\''`)}'`;
}

function expandTilde(path, env) {
  const value = String(path ?? '').trim();
  if (value === '~') return env.HOME ?? value;
  if (value.startsWith('~/')) return resolve(env.HOME ?? '.', value.slice(2));
  return value;
}

function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

export function readEnvLocalFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    let value = valueParts.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key.trim()] = value;
  }

  return env;
}

export function buildPrepromotionProcessEnv({
  cwd = process.cwd(),
  env = process.env,
  envFile = '.env.local',
} = {}) {
  return {
    ...readEnvLocalFile(resolve(cwd, envFile)),
    ...env,
  };
}

export function shouldRunWindowsPrepromotionCanary(stagingVerification) {
  return (
    stagingVerification.STAGING_WINDOWS_FIREFOX_HIGH_RISK === 'true' &&
    (stagingVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT !== 'success' ||
      stagingVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA !==
        stagingVerification.STAGING_VERIFIED_APP_SHA ||
      stagingVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID !== 'none')
  );
}

export function buildWindowsPrepromotionCommand({
  artifactDir,
  openpathRoot = DEFAULT_OPENPATH_ROOT,
} = {}) {
  const command = [
    'npm',
    'run',
    'diagnostics:windows-ajax:direct',
    '--',
    '--environment',
    'staging',
  ];
  if (artifactDir) {
    command.push('--artifact-dir', artifactDir);
  }
  if (openpathRoot) {
    command.push('--openpath-root', openpathRoot);
  }
  return command;
}

export function buildWindowsPrepromotionCommandText(options = {}) {
  return buildWindowsPrepromotionCommand(options).map(shellQuote).join(' ');
}

export function readStagingVerificationFromFile(path) {
  return parseReleaseStateText(readFileSync(path, 'utf8'));
}

export function readStagingVerificationFromHost({
  stagingHost,
  stagingUser = 'deploy',
  stagingPort = '22',
  stagingSshKey,
  stagingSshConfig = '/dev/null',
  stagingSshStrictHostkey = 'accept-new',
  remotePath = DEFAULT_STAGING_VERIFICATION_PATH,
}) {
  if (!stagingHost) throw new Error('--staging-host requires a value');
  if (!stagingSshKey)
    throw new Error('--staging-ssh-key or STAGING_SSH_KEY is required with --staging-host');

  const output = execFileSync(
    'ssh',
    [
      '-F',
      stagingSshConfig,
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      `StrictHostKeyChecking=${stagingSshStrictHostkey}`,
      '-i',
      stagingSshKey,
      '-p',
      String(stagingPort),
      `${stagingUser}@${stagingHost}`,
      `cat ${shellQuote(remotePath)}`,
    ],
    { encoding: 'utf8' }
  );
  return parseReleaseStateText(output);
}

export function resolveWindowsPrepromotionRequirement({
  stagingVerification,
  artifactDir,
  openpathRoot = DEFAULT_OPENPATH_ROOT,
  targetSha,
} = {}) {
  const stagedSha =
    valueOrNull(targetSha) ?? valueOrNull(stagingVerification?.STAGING_VERIFIED_APP_SHA);
  const effectiveVerification = { ...stagingVerification };
  if (stagedSha) effectiveVerification.STAGING_VERIFIED_APP_SHA = stagedSha;

  const command = buildWindowsPrepromotionCommandText({ artifactDir, openpathRoot });
  const persistCommand = buildPersistCommand({
    appSha: stagedSha ?? '<staged-sha>',
    runId: 'direct-staging-<timestamp>',
    failureBoundaryId: 'none',
    failureBoundaryMessage: '<artifact message>',
    result: 'success',
  });

  if (!isTrueFlag(effectiveVerification.STAGING_WINDOWS_FIREFOX_HIGH_RISK)) {
    return {
      state: 'not_required',
      required: false,
      reason: 'STAGING_WINDOWS_FIREFOX_HIGH_RISK is not true.',
      command,
      persistCommand: '',
    };
  }

  if (effectiveVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT !== 'success') {
    return {
      state: 'failed',
      required: true,
      reason: 'missing STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT for staged SHA',
      command,
      persistCommand,
    };
  }

  if (
    !valueOrNull(effectiveVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA) ||
    effectiveVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA !==
      effectiveVerification.STAGING_VERIFIED_APP_SHA
  ) {
    return {
      state: 'failed',
      required: true,
      reason: 'stale STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA for staged SHA',
      command,
      persistCommand,
    };
  }

  if (effectiveVerification.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID !== 'none') {
    return {
      state: 'failed',
      required: true,
      reason: 'STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID is not none',
      command,
      persistCommand,
    };
  }

  return {
    state: 'passed',
    required: false,
    reason: 'fresh Windows prepromotion evidence already exists for staged SHA',
    command,
    persistCommand: '',
  };
}

export function buildPersistCommand({
  result,
  appSha,
  runId,
  failureBoundaryId,
  failureBoundaryMessage,
}) {
  return [
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${shellQuote(result)}`,
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA=${shellQuote(appSha)}`,
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID=${shellQuote(runId)}`,
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID=${shellQuote(failureBoundaryId)}`,
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE=${shellQuote(failureBoundaryMessage)}`,
    'bash scripts/persist-staging-windows-bootstrap-canary.sh',
  ].join(' ');
}

function assertStagedShaMatches({ appSha, targetSha, stagingVerification }) {
  const stagedSha = valueOrNull(stagingVerification?.STAGING_VERIFIED_APP_SHA);
  const explicitSha = valueOrNull(targetSha);

  if (explicitSha && stagedSha && explicitSha !== stagedSha) {
    throw new Error(
      `Target SHA ${explicitSha} does not match staging verification SHA ${stagedSha}`
    );
  }

  if (!valueOrNull(appSha)) {
    throw new Error('Cannot persist Windows prepromotion evidence without a staged app SHA');
  }
}

function resolveTargetSha({ targetSha, stagingVerification }) {
  const explicit = valueOrNull(targetSha);
  if (explicit) return explicit;

  const staged = valueOrNull(stagingVerification?.STAGING_VERIFIED_APP_SHA);
  if (staged) return staged;

  return execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
}

export function readCanaryArtifact(artifactPath) {
  if (!existsSync(artifactPath)) {
    throw new Error(`Windows AJAX canary artifact not found: ${artifactPath}`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function deriveBoundaryMessage(artifact) {
  return (
    valueOrNull(artifact?.failureBoundary?.message) ??
    valueOrNull(artifact?.message) ??
    'Windows AJAX direct staging canary completed.'
  );
}

export function buildWindowsPrepromotionPersistEnv({
  artifact,
  appSha,
  targetSha,
  stagingVerification,
  runId = `direct-staging-${Date.now()}`,
  env = process.env,
} = {}) {
  assertStagedShaMatches({ appSha, targetSha, stagingVerification });

  const boundaryId = valueOrNull(artifact?.failureBoundary?.id) ?? 'unknown';
  const canarySucceeded = artifact?.success !== false && boundaryId === 'none';
  return {
    ...env,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: canarySucceeded ? 'success' : 'failed',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA: appSha,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID: runId,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID: boundaryId,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE: deriveBoundaryMessage(artifact),
    ...(canarySucceeded ? { STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success' } : {}),
  };
}

function buildStagingSshArgs({ env, remoteCommand }) {
  const stagingSshKey = expandTilde(env.STAGING_SSH_KEY, env);
  if (!stagingSshKey) {
    throw new Error('STAGING_SSH_KEY is required to persist prepromotion rehearsal success');
  }

  return [
    '-F',
    '/dev/null',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `StrictHostKeyChecking=${env.STAGING_SSH_STRICT_HOSTKEY ?? 'no'}`,
    '-i',
    stagingSshKey,
    '-p',
    String(env.STAGING_PORT ?? '22'),
    `${env.STAGING_USER ?? 'deploy'}@${env.STAGING_HOST ?? '192.168.1.114'}`,
    remoteCommand,
  ];
}

function buildPersistPrepromotionRehearsalCommand(env) {
  const stateDir = env.STATE_DIR ?? '/opt/classroompath/release-state';
  const appDir = env.APP_DIR ?? '/opt/classroompath/app';
  return [
    `STATE_DIR=${shellQuote(stateDir)}`,
    `APP_DIR=${shellQuote(appDir)}`,
    `INPUT_STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA=${shellQuote(
      env.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA
    )}`,
    'bash -s',
  ].join(' ');
}

function persistPrepromotionRehearsalSuccess({ env, cwd, spawnCommand }) {
  const remoteCommand = buildPersistPrepromotionRehearsalCommand(env);
  const persistResult = spawnCommand('ssh', buildStagingSshArgs({ env, remoteCommand }), {
    cwd,
    env,
    input: `
set -euo pipefail

state_file="$STATE_DIR/staging-verification.env"
release_state_sh="$APP_DIR/scripts/lib/release-state.sh"

if [ ! -f "$state_file" ]; then
  echo "Staging verification state file not found: $state_file" >&2
  exit 1
fi

if [ ! -f "$release_state_sh" ]; then
  echo "release-state helper not found at $release_state_sh" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$state_file"
if [ "\${STAGING_VERIFIED_APP_SHA:-}" != "$INPUT_STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA" ]; then
  echo "Staging verification SHA does not match Windows prepromotion canary SHA" >&2
  exit 1
fi

STAGING_PREPROMOTION_REHEARSAL_RESULT=success
# shellcheck disable=SC1090
source "$release_state_sh"
write_staging_verification_state "$state_file"
`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (persistResult.status !== 0) {
    throw new Error(
      `Persisting staging prepromotion rehearsal failed with exit code ${persistResult.status ?? 1}`
    );
  }
}

export function runAndPersistWindowsPrepromotionEvidence({
  artifactDir,
  openpathRoot = DEFAULT_OPENPATH_ROOT,
  targetSha,
  stagingVerification,
  env = process.env,
  cwd = process.cwd(),
  spawnCommand = spawnSync,
} = {}) {
  const resolvedArtifactDir =
    artifactDir ?? mkdtempSync(resolve(tmpdir(), 'classroompath-prepromotion-windows-'));
  const command = buildWindowsPrepromotionCommand({
    artifactDir: resolvedArtifactDir,
    openpathRoot,
  });
  const runResult = spawnCommand(command[0], command.slice(1), { cwd, env, stdio: 'inherit' });
  if (runResult.status !== 0) {
    throw new Error(`Windows AJAX direct canary failed with exit code ${runResult.status ?? 1}`);
  }

  const artifactPath = resolve(resolvedArtifactDir, CANARY_ARTIFACT_NAME);
  const artifact = readCanaryArtifact(artifactPath);
  const appSha = resolveTargetSha({ targetSha, stagingVerification });
  const persistEnv = buildWindowsPrepromotionPersistEnv({
    artifact,
    appSha,
    targetSha,
    stagingVerification,
    env,
  });

  const persistResult = spawnCommand(
    'bash',
    ['scripts/persist-staging-windows-bootstrap-canary.sh'],
    {
      cwd,
      env: persistEnv,
      stdio: 'inherit',
    }
  );
  if (persistResult.status !== 0) {
    throw new Error(
      `Persisting staging Windows bootstrap canary failed with exit code ${persistResult.status ?? 1}`
    );
  }

  if (persistEnv.STAGING_PREPROMOTION_REHEARSAL_RESULT === 'success') {
    persistPrepromotionRehearsalSuccess({ env: persistEnv, cwd, spawnCommand });
  }

  return {
    artifactPath,
    command,
    persisted: {
      STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT,
      STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA: persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA,
      STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID: persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID,
      STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID:
        persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID,
      STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE:
        persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE,
      ...(persistEnv.STAGING_PREPROMOTION_REHEARSAL_RESULT
        ? {
            STAGING_PREPROMOTION_REHEARSAL_RESULT: persistEnv.STAGING_PREPROMOTION_REHEARSAL_RESULT,
          }
        : {}),
    },
  };
}

export { DIRECT_WINDOWS_COMMAND };
