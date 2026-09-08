#!/usr/bin/env node

/**
 * Runs candidate-sensitive promotion contract checks from the exact RC commit.
 *
 * The operator checkout remains on canonical origin/main. This adapter creates
 * a detached temporary worktree at the selected candidate and invokes the
 * candidate's own Release Bundle, promotion-evidence, and readiness-contract
 * helpers. It never creates a tag, pushes, deploys, or mutates release state.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RC_RUN_ID_PATTERN = /^\d+$/;
const TAG_PATTERN = /^v\d+(?:\.\d+){2,}$/;

const FLAG_TO_OPTION = Object.freeze({
  '--candidate-sha': 'candidateSha',
  '--rc-run-id': 'rcRunId',
  '--tag': 'tag',
  '--release-id': 'releaseId',
  '--openpath-sha': 'openpathSha',
  '--contract-sha256': 'contractSha256',
  '--bundle-file': 'bundleFile',
  '--contract-file': 'contractFile',
  '--staging-current': 'stagingCurrent',
  '--staging-verification': 'stagingVerification',
  '--repo-root': 'repoRoot',
});

export function parseCandidateToolingArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!Object.hasOwn(FLAG_TO_OPTION, flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = String(argv[++index] ?? '').trim();
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    options[FLAG_TO_OPTION[flag]] = value;
  }
  return options;
}

function required(value, label, pattern) {
  const normalized = String(value ?? '').trim();
  if (!pattern.test(normalized)) {
    throw new Error(`${label} has an invalid exact identity`);
  }
  return normalized;
}

function runGit(repoRoot, args) {
  return String(
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  ).trim();
}

function runNode(scriptPath, args, cwd) {
  try {
    return execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim();
    const stdout = String(error?.stdout ?? '').trim();
    const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(`candidate helper ${scriptPath} failed: ${detail}`, { cause: error });
  }
}

function ensureFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  return path;
}

async function assertReadinessContract(candidateRoot, identity) {
  const modulePath = ensureFile(
    join(candidateRoot, 'scripts/lib/production-readiness.mjs'),
    'candidate production-readiness contract'
  );
  const candidateReadiness = await import(pathToFileURL(modulePath).href);
  if (
    typeof candidateReadiness.runProductionReadiness !== 'function' ||
    !Array.isArray(candidateReadiness.READINESS_CHECKS)
  ) {
    throw new Error('candidate production-readiness contract exports are incompatible');
  }

  const checks = Object.fromEntries(
    candidateReadiness.READINESS_CHECKS.map(({ name }) => [
      name,
      async () => ({ ok: true, message: 'contract probe' }),
    ])
  );
  const report = await candidateReadiness.runProductionReadiness({ identity, checks });
  if (!report.ok || report.mutationAttempted !== false) {
    throw new Error('candidate production-readiness contract rejected the exact identity');
  }
  return report;
}

export async function runCandidateToolingCompatibility({
  candidateSha,
  rcRunId,
  tag,
  releaseId,
  openpathSha,
  contractSha256,
  bundleFile,
  contractFile,
  stagingCurrent,
  stagingVerification,
  repoRoot = projectRoot,
} = {}) {
  const identity = {
    candidateSha: required(candidateSha, 'candidateSha', SHA40_PATTERN),
    rcRunId: required(rcRunId, 'rcRunId', RC_RUN_ID_PATTERN),
    releaseId: required(releaseId, 'releaseId', SHA256_PATTERN),
    openpathSha: required(openpathSha, 'openpathSha', SHA40_PATTERN),
    contractSha256: required(contractSha256, 'contractSha256', SHA256_PATTERN),
  };
  const normalizedTag = String(tag ?? '').trim();
  if (!TAG_PATTERN.test(normalizedTag)) {
    throw new Error('tag has an invalid production tag format');
  }

  const operatorRoot = resolve(repoRoot);
  const bundlePath = ensureFile(resolve(bundleFile), 'Release Bundle');
  const contractPath = ensureFile(resolve(contractFile), 'OpenPath contract');
  const stagingCurrentPath = ensureFile(resolve(stagingCurrent), 'staging current evidence');
  const stagingVerificationPath = ensureFile(
    resolve(stagingVerification),
    'staging verification evidence'
  );

  try {
    runGit(operatorRoot, ['cat-file', '-e', `${identity.candidateSha}^{commit}`]);
  } catch (error) {
    throw new Error(`candidate commit does not exist: ${identity.candidateSha}`, { cause: error });
  }
  const candidateOpenpathSha = runGit(operatorRoot, [
    'rev-parse',
    `${identity.candidateSha}:upstream/openpath`,
  ]);
  if (candidateOpenpathSha !== identity.openpathSha) {
    throw new Error(
      `candidate OpenPath gitlink ${candidateOpenpathSha} does not match ${identity.openpathSha}`
    );
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'classroompath-candidate-tooling-'));
  const candidateRoot = join(temporaryRoot, 'candidate');
  const tagMessagePath = join(temporaryRoot, 'promotion-tag-message.txt');
  let worktreeAdded = false;
  try {
    runGit(operatorRoot, ['worktree', 'add', '--detach', candidateRoot, identity.candidateSha]);
    worktreeAdded = true;
    const worktreeHead = runGit(candidateRoot, ['rev-parse', 'HEAD']);
    if (worktreeHead !== identity.candidateSha) {
      throw new Error(
        `candidate worktree resolved ${worktreeHead}, expected ${identity.candidateSha}`
      );
    }

    const operatorEvidenceCli = ensureFile(
      join(operatorRoot, 'scripts/promotion-evidence-cli.mjs'),
      'operator promotion-evidence helper'
    );
    const candidateBundleCli = ensureFile(
      join(candidateRoot, 'scripts/release-bundle.mjs'),
      'candidate Release Bundle helper'
    );
    const candidateEvidenceCli = ensureFile(
      join(candidateRoot, 'scripts/promotion-evidence-cli.mjs'),
      'candidate promotion-evidence helper'
    );

    runNode(
      candidateBundleCli,
      [
        'verify',
        '--bundle-file',
        bundlePath,
        '--contract-file',
        contractPath,
        '--release-id',
        identity.releaseId,
        '--classroompath-sha',
        identity.candidateSha,
        '--openpath-sha',
        identity.openpathSha,
      ],
      candidateRoot
    );

    runNode(
      operatorEvidenceCli,
      [
        'write-tag-message',
        '--tag',
        normalizedTag,
        '--commit',
        identity.candidateSha,
        '--release-id',
        identity.releaseId,
        '--rc-run-id',
        identity.rcRunId,
        '--classroompath-sha',
        identity.candidateSha,
        '--openpath-sha',
        identity.openpathSha,
        '--contract-sha256',
        identity.contractSha256,
        '--staging-current',
        stagingCurrentPath,
        '--staging-verification',
        stagingVerificationPath,
        '--output',
        tagMessagePath,
      ],
      operatorRoot
    );

    runNode(
      candidateEvidenceCli,
      [
        'verify-tag-identity',
        '--message-file',
        tagMessagePath,
        '--tag',
        normalizedTag,
        '--release-id',
        identity.releaseId,
        '--rc-run-id',
        identity.rcRunId,
        '--classroompath-sha',
        identity.candidateSha,
        '--openpath-sha',
        identity.openpathSha,
        '--contract-sha256',
        identity.contractSha256,
      ],
      candidateRoot
    );

    await assertReadinessContract(candidateRoot, identity);

    return {
      candidateSha: identity.candidateSha,
      candidateOpenpathSha,
      candidateRoot,
      checks: ['release-bundle-v2', 'promotion-tag-identity', 'production-readiness-contract'],
      tagMessage: readFileSync(tagMessagePath, 'utf8'),
    };
  } finally {
    try {
      runGit(operatorRoot, ['worktree', 'remove', '--force', candidateRoot]);
    } catch {
      // The cleanup below still removes the isolated path if worktree creation failed.
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
    if (worktreeAdded) {
      try {
        runGit(operatorRoot, ['worktree', 'prune']);
      } catch {
        // Best-effort cleanup must not hide the candidate validation result.
      }
    }
  }
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    const result = await runCandidateToolingCompatibility(
      parseCandidateToolingArgs(process.argv.slice(2))
    );
    process.stdout.write(
      JSON.stringify({
        candidateSha: result.candidateSha,
        candidateOpenpathSha: result.candidateOpenpathSha,
        checks: result.checks,
      }) + '\n'
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
