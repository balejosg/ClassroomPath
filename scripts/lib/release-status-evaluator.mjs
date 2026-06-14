// @ts-check

/**
 * Pure evaluation functions that derive release blocker groups from collected release status evidence.
 *
 * Invoked by: Imported by `scripts/release-status.mjs` and `scripts/lib/release-preflight.mjs`.
 * Usage: (library module, not invoked directly)
 * Tested by `tests/release-status.test.ts`.
 */

import { evaluateStagingEligibility } from './promotion-eligibility-contract.mjs';

function isSuccess(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'success'
  );
}

export function isReleaseCandidateAvailable(releaseCandidate) {
  return (
    releaseCandidate.latestRun?.conclusion === 'success' &&
    releaseCandidate.manifestStatus === 'read' &&
    Boolean(releaseCandidate.manifest)
  );
}

export function isStagingPromotionEligible({ status, stagingState, stagingCurrentImages }) {
  const result = evaluateStagingEligibility({
    stagingState,
    stagingCurrentImages,
    headSha: status.classroomPath.headSha,
    submoduleSha: status.openPath.submoduleSha,
  });
  return result.eligible;
}

export function hasWindowsPrepromotionEvidence(stagingState) {
  return isSuccess(stagingState.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT);
}

export function isProductionCurrentAtTarget(status) {
  return (
    status.productionDeploy.latestRun?.conclusion === 'success' &&
    status.productionDeploy.currentState?.APP_SHA === status.classroomPath.headSha
  );
}

export function deriveReleaseBlockers(status) {
  const groups = deriveReleaseBlockerGroups(status);
  return [...groups.promotionBlockers, ...groups.productionBlockers];
}

export function deriveReleaseBlockerGroups(status) {
  const blockers = [];
  const productionBlockers = [];
  const stagingState = status.stagingVerification.state ?? {};
  const stagingCurrentImages = status.stagingCurrentImages.state ?? {};

  if (
    status.classroomPath.originMainSha &&
    status.classroomPath.headSha !== status.classroomPath.originMainSha
  ) {
    blockers.push('classroompath-head-behind-origin');
  }

  if (
    status.openPath.requiredChecks.length === 0 ||
    status.openPath.requiredChecks.some((check) => check.status !== 'success')
  ) {
    blockers.push('openpath-required-checks-not-green');
  }

  if (!isReleaseCandidateAvailable(status.releaseCandidate)) {
    blockers.push('release-candidate-missing');
  }

  if (!isStagingPromotionEligible({ status, stagingState, stagingCurrentImages })) {
    blockers.push('staging-not-promotion-eligible');
  }

  if (!hasWindowsPrepromotionEvidence(stagingState)) {
    blockers.push('windows-prepromotion-evidence-missing');
  }

  if (status.operationalTargets?.placeholders?.length > 0) {
    blockers.push('operational-target-placeholder');
  }

  if (status.productionDeploy.latestRun?.conclusion !== 'success') {
    productionBlockers.push('production-deploy-not-success');
  }

  return {
    promotionBlockers: blockers,
    productionBlockers,
  };
}

/**
 * Returns a map of blocker-id → human-readable detail string for the given status.
 * Used by renderers (renderReleaseStatusText, release-preflight) to enrich output
 * without changing the stable machine-readable blocker ID strings.
 *
 * @param {object} status
 * @returns {Record<string, string>}
 */
export function deriveBlockerDetails(status) {
  const stagingState = status.stagingVerification?.state ?? {};
  const stagingCurrentImages = status.stagingCurrentImages?.state ?? {};
  const details = {};

  // classroompath-head-behind-origin
  const headSha = String(status.classroomPath?.headSha ?? '').trim();
  const originSha = String(status.classroomPath?.originMainSha ?? '').trim();
  if (headSha && originSha && headSha !== originSha) {
    details['classroompath-head-behind-origin'] =
      `HEAD=${headSha.slice(0, 12)}, origin/main=${originSha.slice(0, 12)}`;
  }

  // openpath-required-checks-not-green
  const checks = status.openPath?.requiredChecks ?? [];
  if (checks.length === 0) {
    details['openpath-required-checks-not-green'] = 'no checks available';
  } else {
    const failing = checks
      .filter((check) => check.status !== 'success')
      .map((check) => `${check.name}=${check.status}`);
    if (failing.length > 0) {
      details['openpath-required-checks-not-green'] = failing.join(', ');
    }
  }

  // release-candidate-missing
  const rc = status.releaseCandidate ?? {};
  const runConclusion = rc.latestRun?.conclusion ?? 'none';
  const manifestStatus = rc.manifestStatus ?? 'none';
  details['release-candidate-missing'] =
    `run-conclusion=${runConclusion}, manifest-status=${manifestStatus}`;

  // staging-not-promotion-eligible
  const eligibility = evaluateStagingEligibility({
    stagingState,
    stagingCurrentImages,
    headSha: status.classroomPath?.headSha ?? '',
    submoduleSha: status.openPath?.submoduleSha ?? '',
  });
  if (!eligibility.eligible) {
    const shortSha = (v) =>
      String(v ?? '').length > 12 ? String(v).slice(0, 12) : String(v ?? '') || 'n/a';
    const parts = eligibility.failures.map((f) => {
      const exp =
        f.expected.length > 12 && /^[0-9a-f]{40}$/.test(f.expected)
          ? shortSha(f.expected)
          : f.expected;
      const act =
        f.actual.length > 12 && /^[0-9a-f]{40}$/.test(f.actual) ? shortSha(f.actual) : f.actual;
      return `${f.field} (expected=${exp}, actual=${act})`;
    });
    details['staging-not-promotion-eligible'] = `staging promotion blocked: ${parts.join(', ')}`;
  }

  // windows-prepromotion-evidence-missing
  const canaryResult = String(stagingState.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? '').trim();
  details['windows-prepromotion-evidence-missing'] =
    `STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${canaryResult || 'n/a'}`;

  // production-deploy-not-success
  const prodConclusion = status.productionDeploy?.latestRun?.conclusion ?? 'none';
  const prodRunId = status.productionDeploy?.latestRun?.databaseId ?? 'none';
  details['production-deploy-not-success'] = `run=${prodRunId}, conclusion=${prodConclusion}`;

  return details;
}
