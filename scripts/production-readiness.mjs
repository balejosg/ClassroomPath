#!/usr/bin/env node

/**
 * Read-only production readiness CLI. It delegates check ordering and result
 * shaping to lib/production-readiness.mjs and delegates recovery authority to
 * the canonical shell operation shared with deploy.yml.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { isDirectExecution } from './lib/github-actions.mjs';
import { readEnvFileIfPresent } from './lib/env-local.mjs';
import {
  READINESS_CHECKS,
  runProductionReadiness,
  sanitizeReadinessMessage,
} from './lib/production-readiness.mjs';
import { viewGitHubWorkflowRun } from './lib/github-actions-artifacts.mjs';
import { assertSuccessfulReleaseCandidateRun } from './lib/release-candidate-resolution.mjs';
import { readReleaseCandidateBundleFromFiles } from './lib/release-candidate-bundle.mjs';
import { assertDeployTargetReady, getDeployTarget } from './deploy-targets.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECOVERY_HELPER = resolve(projectRoot, 'scripts/lib/production-recovery-preflight.sh');
const PRODUCTION_TARGET_PREFLIGHT = resolve(
  projectRoot,
  'scripts/preflight-production-promotion-target.sh'
);
const STAGING_EXACT_PREFLIGHT = resolve(
  projectRoot,
  'scripts/preflight-current-staging-promotion.sh'
);

export function parseProductionReadinessArgs(argv) {
  const options = {
    rcRunId: '',
    candidateSha: '',
    releaseId: '',
    openpathSha: '',
    contractSha256: '',
    recoverySha: '',
    recoverySourceRoot: '',
    recoveryArtifact: '',
    recoveryEvidence: '',
    bundleFile: '',
    contractFile: '',
    json: false,
    help: false,
  };
  const valueFlags = new Set([
    '--rc-run-id',
    '--candidate-sha',
    '--release-id',
    '--openpath-sha',
    '--contract-sha256',
    '--recovery-sha',
    '--recovery-source-root',
    '--recovery-artifact',
    '--recovery-evidence',
    '--bundle-file',
    '--contract-file',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!valueFlags.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    const key = {
      '--rc-run-id': 'rcRunId',
      '--candidate-sha': 'candidateSha',
      '--release-id': 'releaseId',
      '--openpath-sha': 'openpathSha',
      '--contract-sha256': 'contractSha256',
      '--recovery-sha': 'recoverySha',
      '--recovery-source-root': 'recoverySourceRoot',
      '--recovery-artifact': 'recoveryArtifact',
      '--recovery-evidence': 'recoveryEvidence',
      '--bundle-file': 'bundleFile',
      '--contract-file': 'contractFile',
    }[arg];
    options[key] = value;
  }
  return options;
}

export function renderProductionReadiness(report) {
  const lines = [
    report.ok ? 'Production readiness passed' : 'Production readiness blocked',
    `rc_run_id: ${report.identity.rcRunId}`,
    `candidate_sha: ${report.identity.candidateSha}`,
    `release_id: ${report.identity.releaseId}`,
    `openpath_sha: ${report.identity.openpathSha}`,
    `contract_sha256: ${report.identity.contractSha256}`,
    `recovery_sha: ${report.identity.recoverySha ?? 'unavailable'}`,
    '',
    'Checks:',
    ...READINESS_CHECKS.map(({ name }) => {
      const check = report.checks[name];
      return `  - ${name}: ${check.ok ? 'ok' : 'blocked'} - ${check.message}`;
    }),
    '',
    'Blockers:',
    ...(report.blockers.length ? report.blockers.map((blocker) => `  - ${blocker}`) : ['  - none']),
  ];
  return `${lines.join('\n')}\n`;
}

export async function runProductionReadinessCommand(
  argv = process.argv.slice(2),
  dependencies = {}
) {
  const io = {
    stdout: dependencies.stdout ?? ((value) => process.stdout.write(value)),
    stderr: dependencies.stderr ?? ((value) => process.stderr.write(value)),
  };

  let options;
  try {
    options = parseProductionReadinessArgs(argv);
    if (options.help) {
      io.stdout(`${usage()}\n`);
      return { status: 0 };
    }

    const env = readEnvFileIfPresent(
      dependencies.env ?? process.env,
      join(projectRoot, '.env.local')
    );
    const identity = {
      rcRunId: options.rcRunId || env.STAGING_RELEASE_RUN_ID || env.RC_RUN_ID,
      candidateSha: options.candidateSha || env.STAGING_CLASSROOMPATH_SHA || env.APP_SHA,
      releaseId: options.releaseId || env.STAGING_RELEASE_ID || env.RELEASE_ID,
      openpathSha: options.openpathSha || env.STAGING_OPENPATH_SHA || env.OPENPATH_SHA,
      contractSha256:
        options.contractSha256 ||
        env.STAGING_OPENPATH_CONTRACT_SHA256 ||
        env.OPENPATH_CONTRACT_SHA256,
      recoverySha: options.recoverySha || env.PRODUCTION_RECOVERY_SHA,
    };

    const checks = dependencies.checks ?? {
      rc: () =>
        runRcCheck({
          identity,
          env,
          cwd: dependencies.cwd ?? projectRoot,
          viewRun: dependencies.viewRun,
        }),
      staging: () => runStagingCheck({ identity, env, cwd: dependencies.cwd ?? projectRoot }),
      recovery: () =>
        runRecoveryCheck({ options, identity, env, cwd: dependencies.cwd ?? projectRoot }),
      config: () => runConfigCheck({ env }),
      host: () => runHostCheck({ env, cwd: dependencies.cwd ?? projectRoot }),
      artifacts: () =>
        runArtifactCheck({
          options,
          identity,
          env,
        }),
    };
    const report = await runProductionReadiness({ identity, checks });
    io.stdout(options.json ? `${JSON.stringify(report)}\n` : renderProductionReadiness(report));
    return { status: report.ok ? 0 : 1, report };
  } catch (error) {
    const message = sanitizeReadinessMessage(
      error instanceof Error ? error.message : String(error)
    );
    io.stderr(`${message}\n`);
    return { status: 2, error: message };
  }
}

function runRcCheck({ identity, env, cwd, viewRun = viewGitHubWorkflowRun }) {
  const configuredRunId = String(env.RC_RUN_ID ?? env.STAGING_RELEASE_RUN_ID ?? '').trim();
  if (configuredRunId && configuredRunId !== identity.rcRunId) {
    return {
      ok: false,
      message: `configured RC run ${configuredRunId} does not match the exact readiness identity`,
    };
  }

  try {
    const repository = String(env.GITHUB_REPOSITORY || 'balejosg/ClassroomPath').trim();
    const run = viewRun({ repo: repository, runId: identity.rcRunId, cwd });
    assertSuccessfulReleaseCandidateRun(run, identity.rcRunId);
    const headSha = String(run?.headSha ?? run?.head_sha ?? '').trim();
    if (headSha !== identity.candidateSha) {
      return {
        ok: false,
        message: `RC run head SHA ${headSha || 'missing'} does not match candidate SHA`,
      };
    }
  } catch (error) {
    return { ok: false, message: errorText(error, 'explicit RC run validation failed') };
  }

  return {
    ok: true,
    message: 'explicit successful RC run and candidate SHA are exact',
  };
}

function runStagingCheck({ identity, env, cwd }) {
  try {
    execFileSync(
      'bash',
      [
        STAGING_EXACT_PREFLIGHT,
        '--staging-only',
        '--rc-run-id',
        identity.rcRunId,
        '--candidate-sha',
        identity.candidateSha,
        '--release-id',
        identity.releaseId,
        '--openpath-sha',
        identity.openpathSha,
        '--contract-sha256',
        identity.contractSha256,
      ],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { ok: true, message: 'staging is running and verified for the exact RC identity' };
  } catch (error) {
    return { ok: false, message: errorText(error, 'exact staging identity verification failed') };
  }
}

async function runRecoveryCheck({ options, identity, env, cwd }) {
  const recoverySha = identity.recoverySha;
  const sourceRoot = options.recoverySourceRoot || env.PRODUCTION_RECOVERY_SOURCE_ROOT;
  if (!recoverySha || !sourceRoot) {
    return {
      ok: false,
      message: 'PRODUCTION_RECOVERY_SHA and an independent recovery source checkout are required',
    };
  }

  const workDir = mkdtempSync(join(tmpdir(), 'classroompath-readiness-recovery-'));
  const artifactPath = options.recoveryArtifact || join(workDir, 'production-recovery-bundle.tgz');
  const evidencePath =
    options.recoveryEvidence || join(workDir, 'production-recovery-authority.env');
  try {
    execFileSync(
      'bash',
      [
        '-c',
        [
          'set -euo pipefail',
          'source "$1"',
          'production_recovery_prepare_and_verify "$2" "$3" "$4" "$5" "$6"',
        ].join('\n'),
        'production-readiness',
        RECOVERY_HELPER,
        recoverySha,
        identity.candidateSha,
        sourceRoot,
        artifactPath,
        evidencePath,
      ],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { ok: true, message: 'exact recovery authority validated and preflighted' };
  } catch (error) {
    return {
      ok: false,
      message: errorText(error, 'recovery authority preflight failed'),
    };
  } finally {
    if (!options.recoveryArtifact && !options.recoveryEvidence) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function runConfigCheck({ env }) {
  try {
    const target = getDeployTarget('production');
    assertDeployTargetReady('production', target);
    const requiredFields = ['publicUrl', 'gatewayHealthUrl', 'readyUrl', 'containerPlatform'];
    const missing = requiredFields.filter((field) => !String(target[field] ?? '').trim());
    if (missing.length > 0) {
      return { ok: false, message: `production config is missing ${missing.join(', ')}` };
    }
    if (!String(env.CLASSROOMPATH_DEPLOY_ROOT ?? '').trim()) {
      return { ok: false, message: 'CLASSROOMPATH_DEPLOY_ROOT is required for production' };
    }
    return { ok: true, message: 'production target config is complete and non-placeholder' };
  } catch (error) {
    return { ok: false, message: errorText(error, 'production config is invalid') };
  }
}

function runHostCheck({ env, cwd }) {
  try {
    execFileSync('bash', [PRODUCTION_TARGET_PREFLIGHT], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, message: 'production SSH host contract is ready' };
  } catch (error) {
    return { ok: false, message: errorText(error, 'production host preflight failed') };
  }
}

function runArtifactCheck({ options, identity, env }) {
  const bundleFile = options.bundleFile || env.RELEASE_BUNDLE_FILE;
  const contractFile = options.contractFile || env.OPENPATH_CONTRACT_FILE;
  if (!bundleFile || !contractFile || !existsSync(bundleFile) || !existsSync(contractFile)) {
    return { ok: false, message: 'exact Release Bundle and OpenPath contract files are required' };
  }

  try {
    const verified = readReleaseCandidateBundleFromFiles({
      bundlePath: bundleFile,
      contractPath: contractFile,
      classroomPathSha: identity.candidateSha,
      releaseId: identity.releaseId,
    });
    if (verified.bundle.openPath.sourceSha !== identity.openpathSha) {
      return {
        ok: false,
        message: 'Release Bundle OpenPath SHA does not match readiness identity',
      };
    }
    if (verified.contract.contractSha256 !== identity.contractSha256) {
      return { ok: false, message: 'OpenPath contract SHA-256 does not match readiness identity' };
    }
    return { ok: true, message: 'exact Release Bundle, contract, and image projection verified' };
  } catch (error) {
    return { ok: false, message: errorText(error, 'exact artifacts failed verification') };
  }
}

function errorText(error, fallback) {
  if (error && typeof error === 'object') {
    const stderr = String(error.stderr ?? '').trim();
    if (stderr) return stderr;
    const message = String(error.message ?? '').trim();
    if (message) return message;
  }
  return fallback;
}

function usage() {
  return 'Usage: npm run verify:production-readiness -- --rc-run-id <id> --candidate-sha <sha> --release-id <id> --openpath-sha <sha> --contract-sha256 <sha> [--recovery-sha <sha>] [--recovery-source-root <dir>] [--bundle-file <path>] [--contract-file <path>] [--json]';
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runProductionReadinessCommand();
  process.exitCode = result.status;
}
