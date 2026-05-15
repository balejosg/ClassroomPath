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

function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
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

function resolveTargetSha({ targetSha, stagingVerification }) {
  const explicit = valueOrNull(targetSha);
  if (explicit) return explicit;

  const staged = valueOrNull(stagingVerification?.STAGING_VERIFIED_APP_SHA);
  if (staged) return staged;

  return execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
}

function readCanaryArtifact(artifactPath) {
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

export function runAndPersistWindowsPrepromotionEvidence({
  artifactDir,
  openpathRoot = DEFAULT_OPENPATH_ROOT,
  targetSha,
  stagingVerification,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const resolvedArtifactDir =
    artifactDir ?? mkdtempSync(resolve(tmpdir(), 'classroompath-prepromotion-windows-'));
  const command = buildWindowsPrepromotionCommand({
    artifactDir: resolvedArtifactDir,
    openpathRoot,
  });
  const runResult = spawnSync(command[0], command.slice(1), { cwd, env, stdio: 'inherit' });
  if (runResult.status !== 0) {
    throw new Error(`Windows AJAX direct canary failed with exit code ${runResult.status ?? 1}`);
  }

  const artifactPath = resolve(resolvedArtifactDir, CANARY_ARTIFACT_NAME);
  const artifact = readCanaryArtifact(artifactPath);
  const boundaryId = valueOrNull(artifact?.failureBoundary?.id) ?? 'unknown';
  const appSha = resolveTargetSha({ targetSha, stagingVerification });
  const persistEnv = {
    ...env,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: boundaryId === 'none' ? 'success' : 'failed',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA: appSha,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID: `direct-staging-${Date.now()}`,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID: boundaryId,
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE: deriveBoundaryMessage(artifact),
  };

  const persistResult = spawnSync('bash', ['scripts/persist-staging-windows-bootstrap-canary.sh'], {
    cwd,
    env: persistEnv,
    stdio: 'inherit',
  });
  if (persistResult.status !== 0) {
    throw new Error(
      `Persisting staging Windows bootstrap canary failed with exit code ${persistResult.status ?? 1}`
    );
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
    },
  };
}

export { DIRECT_WINDOWS_COMMAND };
