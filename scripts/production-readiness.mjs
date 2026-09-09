#!/usr/bin/env node

/**
 * Read-only production readiness CLI. It delegates check ordering and result
 * shaping to lib/production-readiness.mjs and delegates recovery authority to
 * the canonical shell operation shared with deploy.yml.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { resolveExplicitReleaseCandidateBundle } from './lib/release-candidate-resolution.mjs';
import {
  buildReleaseCandidateBundleRuntimeProjection,
  readReleaseCandidateBundleFromFiles,
  writeResolvedReleaseCandidateBundleArtifacts,
} from './lib/release-candidate-bundle.mjs';
import { assertDeployTargetReady, getDeployTarget } from './deploy-targets.mjs';
import { preflightGhcrImages } from './lib/ghcr-preflight.mjs';
import {
  buildCanonicalReleaseManifestFromBundle,
  serializeReleaseManifest,
} from './lib/release-manifest.mjs';
import { verifyReleaseManifestPlatforms } from './verify-release-manifest-platforms.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_HOST_READINESS = resolve(
  projectRoot,
  'scripts/verify-production-host-readiness.sh'
);
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
    highRisk: '',
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
    '--high-risk',
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
      '--high-risk': 'highRisk',
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
  let resolutionWorkDir = '';

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
    let identity = {
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
    const suppliedIdentity = { ...identity };
    let resolvedCandidate = null;
    const completeSuppliedIdentity =
      identity.candidateSha &&
      identity.releaseId &&
      identity.openpathSha &&
      identity.contractSha256 &&
      options.bundleFile &&
      options.contractFile;
    if (!completeSuppliedIdentity) {
      const resolveCandidate =
        dependencies.resolveCandidate ?? resolveExplicitReleaseCandidateBundle;
      resolvedCandidate = await resolveCandidate({
        repository: String(env.GITHUB_REPOSITORY || 'balejosg/ClassroomPath').trim(),
        rcRunId: identity.rcRunId,
        cwd: dependencies.cwd ?? projectRoot,
      });
      const resolvedIdentity = {
        rcRunId: String(resolvedCandidate.rcRunId ?? resolvedCandidate.runId ?? ''),
        candidateSha: String(resolvedCandidate.classroomPathSha ?? resolvedCandidate.headSha ?? ''),
        releaseId: String(resolvedCandidate.releaseId ?? ''),
        openpathSha: String(resolvedCandidate.bundle?.openPath?.sourceSha ?? ''),
        contractSha256: String(resolvedCandidate.contract?.contractSha256 ?? ''),
        recoverySha: identity.recoverySha,
      };
      for (const field of [
        'rcRunId',
        'candidateSha',
        'releaseId',
        'openpathSha',
        'contractSha256',
      ]) {
        if (suppliedIdentity[field] && suppliedIdentity[field] !== resolvedIdentity[field]) {
          throw new Error(`${field} supplied by the operator does not match the explicit RC`);
        }
      }
      identity = resolvedIdentity;
      resolutionWorkDir = mkdtempSync(join(tmpdir(), 'classroompath-readiness-rc-'));
      const paths = writeResolvedReleaseCandidateBundleArtifacts(
        resolutionWorkDir,
        resolvedCandidate
      );
      options.bundleFile = paths.bundlePath;
      options.contractFile = paths.contractPath;
    }

    const checks = dependencies.checks ?? {
      rc: () =>
        resolvedCandidate
          ? { ok: true, message: 'explicit successful RC run and candidate SHA are exact' }
          : runRcCheck({
              identity,
              env,
              cwd: dependencies.cwd ?? projectRoot,
              viewRun: dependencies.viewRun,
            }),
      staging: () =>
        runStagingCheck({
          identity,
          options,
          env,
          cwd: dependencies.cwd ?? projectRoot,
          verifyBundle: dependencies.verifyBundle,
          highRisk: options.highRisk || env.PRODUCTION_READINESS_HIGH_RISK || 'false',
        }),
      recovery: () =>
        runRecoveryCheck({ options, identity, env, cwd: dependencies.cwd ?? projectRoot }),
      config: () => runConfigCheck({ env, execFile: dependencies.execFile }),
      host: () => runHostCheck({ env, cwd: dependencies.cwd ?? projectRoot }),
      artifacts: () =>
        runArtifactCheck({
          options,
          identity,
          env,
          preflightImages: dependencies.preflightImages,
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
  } finally {
    if (resolutionWorkDir) {
      rmSync(resolutionWorkDir, { recursive: true, force: true });
    }
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

export function runStagingCheck({
  identity,
  options,
  env,
  cwd,
  verifyBundle = readReleaseCandidateBundleFromFiles,
  highRisk = 'false',
}) {
  try {
    const verified = verifyBundle({
      bundlePath: options.bundleFile,
      contractPath: options.contractFile,
      classroomPathSha: identity.candidateSha,
      releaseId: identity.releaseId,
    });
    const runtime = buildReleaseCandidateBundleRuntimeProjection(verified);
    const exactRuntimeEnv = {
      ...env,
      EXPECTED_APP_SHA: identity.candidateSha,
      EXPECTED_RELEASE_ID: identity.releaseId,
      EXPECTED_RC_RUN_ID: identity.rcRunId,
      EXPECTED_OPENPATH_SHA: identity.openpathSha,
      EXPECTED_OPENPATH_CONTRACT_SHA256: identity.contractSha256,
      EXPECTED_GATEWAY_IMAGE: runtime.CLASSROOMPATH_GATEWAY_IMAGE,
      EXPECTED_MIGRATIONS_IMAGE: runtime.CLASSROOMPATH_MIGRATIONS_IMAGE,
      EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE: runtime.OPENPATH_FIREFOX_ASSETS_IMAGE,
      EXPECTED_OPENPATH_API_IMAGE: runtime.OPENPATH_API_IMAGE,
      EXPECTED_OPENPATH_VERSION: runtime.OPENPATH_VERSION,
      EXPECTED_OPENPATH_LINUX_AGENT_VERSION: runtime.OPENPATH_LINUX_AGENT_VERSION,
      EXPECTED_OPENPATH_LINUX_AGENT_APT_SUITE: runtime.OPENPATH_LINUX_AGENT_APT_SUITE,
      EXPECTED_SPA_IMAGE: runtime.CLASSROOMPATH_SPA_IMAGE,
      EXPECTED_VERIFIER_IMAGE: runtime.CLASSROOMPATH_VERIFIER_IMAGE,
      EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:
        runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION,
      EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:
        runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT,
      EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:
        runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG,
      EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:
        runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256,
    };
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
        '--high-risk',
        String(highRisk),
      ],
      { cwd, env: exactRuntimeEnv, stdio: ['ignore', 'pipe', 'pipe'] }
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
    const candidateHelper = join(workDir, 'production-recovery-preflight.sh');
    const helperBytes = execFileSync(
      'git',
      ['show', `${identity.candidateSha}:scripts/lib/production-recovery-preflight.sh`],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    writeFileSync(candidateHelper, helperBytes, { mode: 0o600 });
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
        candidateHelper,
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

export function runConfigCheck({
  env,
  getTarget = getDeployTarget,
  assertTargetReady = assertDeployTargetReady,
  execFile = execFileSync,
  checkGitHub = true,
}) {
  try {
    const target = getTarget('production');
    assertTargetReady('production', target);
    const requiredFields = ['publicUrl', 'gatewayHealthUrl', 'readyUrl', 'containerPlatform'];
    const missing = requiredFields.filter((field) => !String(target[field] ?? '').trim());
    const requiredEnvNames = ['CLASSROOMPATH_DEPLOY_ROOT', 'DEPLOY_USER'];
    missing.push(...requiredEnvNames.filter((name) => !String(env[name] ?? '').trim()));
    if (checkGitHub) {
      const repository = String(env.GITHUB_REPOSITORY || 'balejosg/ClassroomPath').trim();
      const listNames = (kind) => {
        const names = new Set();
        for (const scopeArgs of [[], ['--env', 'production']]) {
          const output = execFile('gh', [kind, 'list', '--repo', repository, ...scopeArgs], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          for (const line of String(output ?? '').split(/\r?\n/u)) {
            const name = line.trim().split(/\s+/u)[0];
            if (name) names.add(name);
          }
        }
        return names;
      };
      const secrets = listNames('secret');
      const variables = listNames('variable');
      const requiredSecrets = [
        'DEPLOY_HOST',
        'DEPLOY_USER',
        'DEPLOY_SSH_KEY',
        'CP_PLATFORM_ADMIN_EMAILS',
        'VAPID_PUBLIC_KEY',
        'VAPID_PRIVATE_KEY',
        'VAPID_CONTACT',
      ];
      const requiredVariables = [
        'CLASSROOMPATH_DEPLOY_ROOT',
        'CP_BILLING_MODE',
        'PRODUCTION_RECOVERY_SHA',
      ];
      missing.push(
        ...requiredSecrets.filter((name) => !secrets.has(name)).map((name) => `secret:${name}`),
        ...requiredVariables
          .filter((name) => !variables.has(name))
          .map((name) => `variable:${name}`)
      );
      for (const alternatives of [
        ['CLASSROOMPATH_PRODUCTION_PUBLIC_URL', 'PRODUCTION_PUBLIC_URL'],
        ['CLASSROOMPATH_PRODUCTION_GATEWAY_HEALTH_URL', 'PRODUCTION_GATEWAY_HEALTH_URL'],
        ['CLASSROOMPATH_PRODUCTION_READY_URL', 'PRODUCTION_READY_URL'],
      ]) {
        if (!alternatives.some((name) => variables.has(name))) {
          missing.push(`variable:${alternatives.join('|')}`);
        }
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        message: `production config is missing ${missing.join(', ')}`,
      };
    }
    return { ok: true, message: 'production target config is complete and non-placeholder' };
  } catch (error) {
    return { ok: false, message: errorText(error, 'production config is invalid') };
  }
}

export function runHostCheck({ env, cwd, execFile = execFileSync }) {
  try {
    for (const preflight of [PRODUCTION_HOST_READINESS, PRODUCTION_TARGET_PREFLIGHT]) {
      execFile('bash', [preflight], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    return {
      ok: true,
      message: 'production SSH host contract, current runtime, and public endpoints are ready',
    };
  } catch (error) {
    return { ok: false, message: errorText(error, 'production host preflight failed') };
  }
}

export async function runArtifactCheck({
  options,
  identity,
  env,
  verifyBundle = readReleaseCandidateBundleFromFiles,
  preflightImages = preflightGhcrImages,
  buildManifest = buildCanonicalReleaseManifestFromBundle,
  verifyPlatforms = verifyReleaseManifestPlatforms,
}) {
  const bundleFile = options.bundleFile || env.RELEASE_BUNDLE_FILE;
  const contractFile = options.contractFile || env.OPENPATH_CONTRACT_FILE;
  if (!bundleFile || !contractFile || !existsSync(bundleFile) || !existsSync(contractFile)) {
    return { ok: false, message: 'exact Release Bundle and OpenPath contract files are required' };
  }

  try {
    const verified = verifyBundle({
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
    const imageRefs = Object.values(verified.bundle.images ?? {});
    const pullability = await preflightImages(imageRefs, { env });
    if (!pullability.ok) {
      const kind = String(
        'failure' in pullability ? (pullability.failure?.kind ?? 'unavailable') : 'unavailable'
      );
      const image = String('image' in pullability ? pullability.image : 'unknown image');
      return { ok: false, message: `immutable OCI artifact ${image} is not pullable (${kind})` };
    }
    const manifest = buildManifest({
      repository: String(env.GITHUB_REPOSITORY || 'balejosg/ClassroomPath').trim(),
      runId: identity.rcRunId,
      bundle: verified.bundle,
      contractBytes: readFileSync(contractFile),
    });
    const manifestText =
      typeof manifest === 'string' ? manifest : serializeReleaseManifest(manifest);
    await verifyPlatforms({
      manifestText,
      targetPlatform: String(
        env.CLASSROOMPATH_PRODUCTION_CONTAINER_PLATFORM ||
          env.CLASSROOMPATH_CONTAINER_PLATFORM ||
          getDeployTarget('production').containerPlatform
      ).trim(),
    });
    return {
      ok: true,
      message: `exact Release Bundle, contract, and ${imageRefs.length} OCI images verified for the production platform`,
    };
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
  return 'Usage: npm run verify:production-readiness -- --rc-run-id <id> --candidate-sha <sha> --release-id <id> --openpath-sha <sha> --contract-sha256 <sha> [--recovery-sha <sha>] [--recovery-source-root <dir>] [--bundle-file <path>] [--contract-file <path>] [--high-risk <true|false>] [--json]';
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runProductionReadinessCommand();
  process.exitCode = result.status;
}
