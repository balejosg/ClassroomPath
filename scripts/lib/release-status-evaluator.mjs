// @ts-check

/**
 * Pure evaluation functions that derive release blocker groups from collected release status evidence.
 *
 * Invoked by: Imported by `scripts/release-status.mjs` and `scripts/lib/release-preflight.mjs`.
 * Usage: (library module, not invoked directly)
 * Tested by `tests/release-status.test.ts`.
 */

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
  return (
    stagingState.STAGING_VERIFIED_APP_SHA === status.classroomPath.headSha &&
    stagingState.STAGING_VERIFIED_OPENPATH_SHA === status.openPath.submoduleSha &&
    stagingState.STAGING_VERIFIED_IMAGE_SOURCE === 'release-candidate' &&
    stagingCurrentImages.IMAGE_SOURCE === 'release-candidate' &&
    isSuccess(stagingState.STAGING_SMOKE_RESULT ?? stagingState.STAGING_SMOKE_STATUS) &&
    isSuccess(stagingState.STAGING_RELEASE_GATE_RESULT) &&
    isSuccess(stagingState.STAGING_PREPROMOTION_REHEARSAL_RESULT)
  );
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
