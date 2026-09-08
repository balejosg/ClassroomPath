// @ts-check

/**
 * Implements the `runReleasePreflight` function: runs all pre-promotion gate checks and returns a structured pass/block result.
 *
 * Invoked by: Imported by `scripts/release-preflight.mjs` (the `npm run release:preflight` CLI entry point).
 * Usage: (library module, not invoked directly)
 * Tested by `tests/release-preflight.test.ts` and `tests/release-orchestration.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseStatus,
  detectOperationalTargetPlaceholders,
  resolveNextPatchTagFromRemoteTags,
} from '../release-status.mjs';
import { readEnvFileIfPresent } from './env-local.mjs';
import { deriveBlockerDetails } from './release-status-evaluator.mjs';
import { evaluateStagingEligibility } from './promotion-eligibility-contract.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '../..');

export function defaultRunCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: options.encoding === 'buffer' ? 'buffer' : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function okCheck(message) {
  return { ok: true, message };
}

function failedCheck(blocker, message) {
  return { ok: false, blocker, message };
}

function isSuccess(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'success'
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readGit(runCommand, args, env) {
  return String(runCommand('git', args, { cwd: projectRoot, env })).trim();
}

function inferNextTag(status) {
  const manifest = status.releaseCandidate?.manifest ?? status.releaseCandidate?.manifestStatus;
  const version =
    manifest?.release_version ??
    manifest?.app_version ??
    manifest?.version ??
    status.releaseCandidate?.manifest?.openpath_version;
  return version ? `v${String(version).replace(/^v/, '')}` : '';
}

export function resolveNextPatchTag(remoteTagsText) {
  return resolveNextPatchTagFromRemoteTags(remoteTagsText);
}

function tryResolveNextTagFromRemote(runCommand, env) {
  try {
    return resolveNextPatchTag(
      readGit(runCommand, ['ls-remote', '--tags', '--refs', 'origin', 'v*'], env)
    );
  } catch {
    return '';
  }
}

function checkReleaseCandidate(status, expectedRcRunId = '', expectedCandidateSha = '') {
  const releaseCandidate = status.releaseCandidate ?? {};
  const available =
    releaseCandidate.latestRun?.conclusion === 'success' &&
    releaseCandidate.manifestStatus === 'read' &&
    Boolean(releaseCandidate.manifest);
  const actualRunId = String(
    releaseCandidate.latestRun?.databaseId ?? releaseCandidate.latestRun?.runId ?? ''
  ).trim();
  if (available && expectedRcRunId) {
    if (actualRunId !== expectedRcRunId) {
      return failedCheck(
        'release-candidate-identity-mismatch',
        `release-candidate-identity-mismatch: expected run ${expectedRcRunId}, received ${actualRunId || 'missing'}`
      );
    }
    const event = String(releaseCandidate.latestRun?.event ?? '')
      .trim()
      .toLowerCase();
    if (event && event !== 'push') {
      return failedCheck(
        'release-candidate-identity-mismatch',
        `release-candidate-identity-mismatch: expected a push RC run, received ${event}`
      );
    }
    const actualHeadSha = String(releaseCandidate.latestRun?.headSha ?? '').trim();
    if (expectedCandidateSha && actualHeadSha !== expectedCandidateSha) {
      return failedCheck(
        'release-candidate-identity-mismatch',
        `release-candidate-identity-mismatch: expected run ${expectedRcRunId} at ${expectedCandidateSha}, received ${actualHeadSha || 'missing'}`
      );
    }
    return okCheck('exact release candidate run and candidate SHA are available');
  }
  if (available) {
    return okCheck('release candidate is available');
  }
  const runConclusion = releaseCandidate.latestRun?.conclusion ?? 'none';
  const manifestStatus = releaseCandidate.manifestStatus ?? 'none';
  return failedCheck(
    'release-candidate-missing',
    `release-candidate-missing: run-conclusion=${runConclusion}, manifest-status=${manifestStatus}`
  );
}

function checkExactPromotionIdentity(status, runCommand, env, identity) {
  if (!identity.candidateSha) {
    return okCheck('exact RC identity is not requested by this legacy preflight invocation');
  }

  const stagingCurrent = status.staging?.currentImages ?? status.stagingCurrentImages?.state ?? {};
  const stagingVerification =
    status.staging?.verification ?? status.stagingVerification?.state ?? {};
  const expectedFields = [
    ['APP_SHA', identity.candidateSha, stagingCurrent.APP_SHA],
    ['RELEASE_ID', identity.releaseId, stagingCurrent.RELEASE_ID],
    ['RC_RUN_ID', identity.rcRunId, stagingCurrent.RC_RUN_ID],
    ['OPENPATH_SHA', identity.openpathSha, stagingCurrent.OPENPATH_SHA],
    ['OPENPATH_CONTRACT_SHA256', identity.contractSha256, stagingCurrent.OPENPATH_CONTRACT_SHA256],
    [
      'STAGING_VERIFIED_APP_SHA',
      identity.candidateSha,
      stagingVerification.STAGING_VERIFIED_APP_SHA,
    ],
    [
      'STAGING_VERIFIED_RELEASE_ID',
      identity.releaseId,
      stagingVerification.STAGING_VERIFIED_RELEASE_ID,
    ],
    [
      'STAGING_VERIFIED_RC_RUN_ID',
      identity.rcRunId,
      stagingVerification.STAGING_VERIFIED_RC_RUN_ID,
    ],
    [
      'STAGING_VERIFIED_OPENPATH_SHA',
      identity.openpathSha,
      stagingVerification.STAGING_VERIFIED_OPENPATH_SHA,
    ],
    [
      'STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256',
      identity.contractSha256,
      stagingVerification.STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256,
    ],
  ];
  const mismatches = expectedFields
    .filter(([, expected]) => expected)
    .filter(([, expected, actual]) => String(actual ?? '').trim() !== expected)
    .map(
      ([field, expected, actual]) =>
        `${field}=${String(actual ?? 'missing')} (expected ${expected})`
    );

  let candidateOpenpathSha = '';
  try {
    candidateOpenpathSha = readGit(
      runCommand,
      ['rev-parse', `${identity.candidateSha}:upstream/openpath`],
      env
    );
  } catch (error) {
    mismatches.push(
      `${identity.candidateSha}:upstream/openpath=${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (identity.openpathSha && candidateOpenpathSha !== identity.openpathSha) {
    mismatches.push(
      `candidate OpenPath SHA=${candidateOpenpathSha || 'missing'} (expected ${identity.openpathSha})`
    );
  }

  return mismatches.length === 0
    ? okCheck('staging and the selected RC commit tree match the exact RC identity')
    : failedCheck(
        'promotion-identity-mismatch',
        `exact RC identity mismatch: ${mismatches.join('; ')}`
      );
}

function checkStagingPromotion(status) {
  const promotionBlockers = status.promotionBlockers ?? [];
  const stagingBlockers = promotionBlockers.filter((blocker) =>
    ['staging-not-promotion-eligible', 'release-candidate-missing'].includes(blocker)
  );
  if (stagingBlockers.length === 0) {
    return okCheck('staging is promotion-eligible');
  }

  const details = deriveBlockerDetails(status);
  const messages = stagingBlockers.map((blocker) => details[blocker] ?? blocker);
  return failedCheck(stagingBlockers[0], `staging promotion blocked: ${messages.join('; ')}`);
}

function checkWindowsEvidence(status) {
  const verification = status.staging?.verification ?? status.stagingVerification?.state ?? {};
  const hasEvidence =
    isSuccess(verification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT) ||
    isSuccess(verification.STAGING_WINDOWS_AJAX_CANARY_RESULT) ||
    isSuccess(verification.STAGING_PREPROMOTION_REHEARSAL_RESULT);
  if (hasEvidence) {
    return okCheck('Windows prepromotion evidence is present');
  }
  const canaryResult =
    String(verification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? '').trim() || 'n/a';
  const prepromotion =
    String(verification.STAGING_PREPROMOTION_REHEARSAL_RESULT ?? '').trim() || 'n/a';
  return failedCheck(
    'windows-prepromotion-evidence-missing',
    `windows-prepromotion-evidence-missing: STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${canaryResult}, STAGING_PREPROMOTION_REHEARSAL_RESULT=${prepromotion}`
  );
}

function checkOperationalTargets(env) {
  const placeholders = detectOperationalTargetPlaceholders(env);
  return placeholders.length === 0
    ? okCheck('operational targets are real values')
    : failedCheck(
        'operational-target-placeholder',
        `Operational target placeholders are not allowed for promotion: ${placeholders
          .map((item) => `${item.name}=${item.value}`)
          .join(', ')}`
      );
}

function checkReleaseFence(status, env) {
  const required =
    env.RELEASE_FENCE_REQUIRED === '1' ||
    env.STAGING_RUN_RELEASE_GATE === '1' ||
    status.staging?.verification?.STAGING_RELEASE_GATE_REQUIRED === '1';
  if (!required) {
    return okCheck('release fence is not required');
  }

  const fenceId =
    env.RELEASE_FENCE_ID ||
    status.staging?.verification?.STAGING_RELEASE_FENCE_ID ||
    status.stagingVerification?.state?.STAGING_RELEASE_FENCE_ID;
  return fenceId
    ? okCheck('release fence id is present')
    : failedCheck(
        'release-fence-missing',
        'release fence is required but no release fence id is present'
      );
}

export async function runReleasePreflight({
  argv = [],
  env = process.env,
  runCommand = defaultRunCommand,
  status = null,
  nextTag = '',
  projectRootOverride = projectRoot,
} = {}) {
  const mergedEnv = readEnvFileIfPresent(env, resolve(projectRootOverride, '.env.local'));
  const exactIdentity = {
    candidateSha: String(
      env.RELEASE_PREFLIGHT_CANDIDATE_SHA ?? env.RELEASE_PREFLIGHT_CLASSROOMPATH_SHA ?? ''
    ).trim(),
    rcRunId: String(env.RELEASE_PREFLIGHT_RC_RUN_ID ?? '').trim(),
    releaseId: String(env.RELEASE_PREFLIGHT_RELEASE_ID ?? '').trim(),
    openpathSha: String(env.RELEASE_PREFLIGHT_OPENPATH_SHA ?? '').trim(),
    contractSha256: String(env.RELEASE_PREFLIGHT_CONTRACT_SHA256 ?? '').trim(),
  };
  const statusArgv = exactIdentity.candidateSha
    ? [
        '--sha',
        exactIdentity.candidateSha,
        ...(exactIdentity.openpathSha ? ['--openpath-sha', exactIdentity.openpathSha] : []),
        ...(exactIdentity.rcRunId ? ['--rc-run-id', exactIdentity.rcRunId] : []),
      ]
    : argv;
  const statusEnv = exactIdentity.candidateSha
    ? { ...mergedEnv, RELEASE_STATUS_SKIP_ORIGIN_MAIN: '1' }
    : mergedEnv;
  const effectiveStatus =
    status ??
    (await buildReleaseStatus({
      argv: statusArgv,
      env: statusEnv,
      runCommand,
    }));
  const tag =
    nextTag ||
    env.RELEASE_PREFLIGHT_NEXT_TAG ||
    tryResolveNextTagFromRemote(runCommand, env) ||
    inferNextTag(effectiveStatus);
  const gitStatus = readGit(runCommand, ['status', '--porcelain'], env);
  const head = readGit(runCommand, ['rev-parse', 'HEAD'], env);
  const originMain = readGit(runCommand, ['rev-parse', 'origin/main'], env);
  const existingTag = tag ? readGit(runCommand, ['tag', '--list', tag], env) : '';

  const checks = {
    cleanCheckout: gitStatus
      ? failedCheck('checkout-not-clean', 'checkout has uncommitted changes')
      : okCheck('checkout is clean'),
    headAtCandidate:
      originMain === head
        ? exactIdentity.candidateSha
          ? okCheck(
              `operator tooling HEAD ${head} matches origin/main; explicit RC ${exactIdentity.candidateSha} remains authoritative`
            )
          : okCheck('HEAD matches origin/main')
        : failedCheck(
            'classroompath-head-not-origin-main',
            `operator tooling HEAD ${head || 'missing'} does not match origin/main ${originMain || 'missing'}`
          ),
    exactPromotionIdentity: checkExactPromotionIdentity(
      effectiveStatus,
      runCommand,
      env,
      exactIdentity
    ),
    releaseCandidate: checkReleaseCandidate(
      effectiveStatus,
      exactIdentity.rcRunId,
      exactIdentity.candidateSha
    ),
    stagingPromotion: checkStagingPromotion(effectiveStatus),
    windowsPrepromotionEvidence: checkWindowsEvidence(effectiveStatus),
    nextTag:
      tag && !existingTag
        ? okCheck(`next tag is available: ${tag}`)
        : failedCheck(
            tag ? 'next-tag-already-exists' : 'next-tag-missing',
            tag ? `next tag already exists: ${tag}` : 'next tag could not be inferred'
          ),
    operationalTargets: checkOperationalTargets(mergedEnv),
    releaseFence: checkReleaseFence(effectiveStatus, env),
  };

  const blockers = unique([
    ...Object.values(checks)
      .filter((check) => !check.ok)
      .map((check) => check.blocker),
    ...(effectiveStatus.promotionBlockers ?? []).filter(
      (blocker) => blocker !== 'production-deploy-not-success'
    ),
  ]);

  return {
    ok: blockers.length === 0,
    nextTag: tag,
    blockers,
    checks,
    status: effectiveStatus,
  };
}
