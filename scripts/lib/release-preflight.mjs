// @ts-check

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseStatus,
  detectOperationalTargetPlaceholders,
  resolveNextPatchTagFromRemoteTags,
} from '../release-status.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '../..');

function defaultRunCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
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

function checkReleaseCandidate(status) {
  const releaseCandidate = status.releaseCandidate ?? {};
  const available =
    releaseCandidate.latestRun?.conclusion === 'success' &&
    releaseCandidate.manifestStatus === 'read' &&
    Boolean(releaseCandidate.manifest);
  return available
    ? okCheck('release candidate is available')
    : failedCheck('release-candidate-missing', 'release candidate run or manifest is missing');
}

function checkStagingPromotion(status) {
  const promotionBlockers = status.promotionBlockers ?? [];
  const stagingBlockers = promotionBlockers.filter((blocker) =>
    ['staging-not-promotion-eligible', 'release-candidate-missing'].includes(blocker)
  );
  return stagingBlockers.length === 0
    ? okCheck('staging is promotion-eligible')
    : failedCheck(
        stagingBlockers[0],
        `staging promotion evidence is blocked: ${stagingBlockers.join(', ')}`
      );
}

function checkWindowsEvidence(status) {
  const verification = status.staging?.verification ?? status.stagingVerification?.state ?? {};
  const hasEvidence =
    isSuccess(verification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT) ||
    isSuccess(verification.STAGING_WINDOWS_AJAX_CANARY_RESULT) ||
    isSuccess(verification.STAGING_PREPROMOTION_REHEARSAL_RESULT);
  return hasEvidence
    ? okCheck('Windows prepromotion evidence is present')
    : failedCheck(
        'windows-prepromotion-evidence-missing',
        'Windows prepromotion evidence is missing; run the maintained prepromotion Windows lane before promotion'
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
} = {}) {
  const effectiveStatus =
    status ??
    (await buildReleaseStatus({
      argv,
      env,
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
    headAtOriginMain:
      head === originMain
        ? okCheck('HEAD matches origin/main')
        : failedCheck('classroompath-head-not-origin-main', 'HEAD does not match origin/main'),
    releaseCandidate: checkReleaseCandidate(effectiveStatus),
    stagingPromotion: checkStagingPromotion(effectiveStatus),
    windowsPrepromotionEvidence: checkWindowsEvidence(effectiveStatus),
    nextTag:
      tag && !existingTag
        ? okCheck(`next tag is available: ${tag}`)
        : failedCheck(
            tag ? 'next-tag-already-exists' : 'next-tag-missing',
            tag ? `next tag already exists: ${tag}` : 'next tag could not be inferred'
          ),
    operationalTargets: checkOperationalTargets(env),
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
