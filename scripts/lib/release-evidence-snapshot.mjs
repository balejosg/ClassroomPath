// @ts-check

/**
 * Defines the release evidence snapshot schema: creation, validation, serialization, and promotion-eligibility evaluation from environment inputs.
 *
 * Invoked by: Imported by `scripts/lib/release-evidence.mjs`, `scripts/lib/release-state-contract.mjs`,
 * and (indirectly) by `scripts/write-release-evidence.mjs`.
 * Usage: (library module, not invoked directly)
 * Tested by `tests/release-evidence.test.ts`.
 */

import { readFileSync } from 'node:fs';

import {
  LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT,
  WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  isTrueFlag,
  valueOrNull,
} from './release-evidence-contract.mjs';

export const STAGING_DEPLOYMENT_MODES = /** @type {const} */ (['promotion-eligible', 'debug']);
export const PROMOTION_ELIGIBILITY_POLICY = Object.freeze({
  requiredDeploymentMode: 'promotion-eligible',
  requiredImageSource: 'release-candidate',
});
export const RELEASE_JOB_RESULT_POLICY = Object.freeze({
  evidenceBearingResults: Object.freeze(['success', 'failure', 'failed']),
  ignoredReusableJobResults: Object.freeze(['success', 'skipped']),
  postReleaseAliases: Object.freeze({
    success: 'live-tested',
    failure: 'failed',
  }),
});

/**
 * @typedef {'promotion-eligible' | 'debug'} StagingDeploymentMode
 * @typedef {Record<string, unknown>} SnapshotRecord
 * @typedef {Record<string, string | undefined | null | SnapshotRecord>} ReleaseEvidenceInput
 */

/**
 * @param {string} deploymentMode
 * @returns {deploymentMode is StagingDeploymentMode}
 */
export function isStagingDeploymentMode(deploymentMode) {
  return STAGING_DEPLOYMENT_MODES.includes(/** @type {StagingDeploymentMode} */ (deploymentMode));
}

/**
 * @param {'release-candidate' | 'source-build'} imageSource
 * @returns {StagingDeploymentMode}
 */
export function deriveStagingDeploymentMode(imageSource) {
  return imageSource === 'release-candidate' ? 'promotion-eligible' : 'debug';
}

export function validateCurrentReleaseState(snapshot, expected) {
  const errors = [];

  if ((snapshot.IMAGE_SOURCE ?? '') !== PROMOTION_ELIGIBILITY_POLICY.requiredImageSource) {
    errors.push(
      `::error::Staging is not running release candidate images (IMAGE_SOURCE=${snapshot.IMAGE_SOURCE ?? 'unset'})`
    );
  }

  const comparisons = [
    ['Staging APP_SHA', expected.EXPECTED_APP_SHA, snapshot.APP_SHA],
    ['Gateway image', expected.EXPECTED_GATEWAY_IMAGE, snapshot.CLASSROOMPATH_GATEWAY_IMAGE],
    [
      'Migrations image',
      expected.EXPECTED_MIGRATIONS_IMAGE,
      snapshot.CLASSROOMPATH_MIGRATIONS_IMAGE,
    ],
    [
      'OpenPath Firefox assets image',
      expected.EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE,
      snapshot.OPENPATH_FIREFOX_ASSETS_IMAGE,
    ],
    ['OpenPath API image', expected.EXPECTED_OPENPATH_API_IMAGE, snapshot.OPENPATH_API_IMAGE],
    ['OpenPath version', expected.EXPECTED_OPENPATH_VERSION, snapshot.OPENPATH_VERSION],
    ['SPA image', expected.EXPECTED_SPA_IMAGE, snapshot.CLASSROOMPATH_SPA_IMAGE],
    [
      'OpenPath Linux agent version',
      expected.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
      snapshot.OPENPATH_LINUX_AGENT_VERSION,
    ],
  ];

  for (const [label, expectedValue, actualValue] of comparisons) {
    if (String(expectedValue ?? '') !== String(actualValue ?? '')) {
      errors.push(`::error::${label} mismatch. expected=${expectedValue} actual=${actualValue}`);
    }
  }

  return errors;
}

export function validateStagingVerification(snapshot, expected) {
  const errors = [];
  const freshnessErrors = [];
  const expectedAppSha = String(expected.EXPECTED_APP_SHA ?? '');
  const verificationState = snapshot.STAGING_VERIFICATION_STATE ?? '';
  const verificationIntentSha =
    snapshot.STAGING_EXPECTED_APP_SHA || snapshot.STAGING_VERIFIED_APP_SHA || 'unknown';

  if (verificationState && verificationState !== 'success') {
    freshnessErrors.push(
      `::error::Staging verification for ${verificationIntentSha} is pending or failed; expected successful evidence for ${expectedAppSha}.`
    );
  }

  if (
    snapshot.STAGING_EXPECTED_APP_SHA &&
    String(snapshot.STAGING_EXPECTED_APP_SHA) !== expectedAppSha
  ) {
    freshnessErrors.push(
      `::error::Staging verification intent mismatch. expected successful evidence for ${expectedAppSha} but current evidence was started for ${snapshot.STAGING_EXPECTED_APP_SHA}.`
    );
  }

  if (freshnessErrors.length > 0) {
    return freshnessErrors;
  }

  if ((snapshot.STAGING_SMOKE_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Staging smoke evidence is missing or failed (STAGING_SMOKE_RESULT=${snapshot.STAGING_SMOKE_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_RELEASE_GATE_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Staging release-gate evidence is missing or failed (STAGING_RELEASE_GATE_RESULT=${snapshot.STAGING_RELEASE_GATE_RESULT ?? 'unset'})`
    );
  }

  if (
    (snapshot.STAGING_ENROLLMENT_DOWNLOAD_RESULT ?? '') !== 'success' ||
    (snapshot.STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT ?? '') !== 'success' ||
    (snapshot.STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT ?? '') !== 'success'
  ) {
    errors.push(
      `::error::Enrollment download evidence is missing or failed (STAGING_ENROLLMENT_DOWNLOAD_RESULT=${snapshot.STAGING_ENROLLMENT_DOWNLOAD_RESULT ?? 'unset'}; STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT=${snapshot.STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT ?? 'unset'}; STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT=${snapshot.STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_VERIFIED_IMAGE_SOURCE ?? '') !== 'release-candidate') {
    errors.push(
      `::error::Staging verification evidence does not point to release candidate images (STAGING_VERIFIED_IMAGE_SOURCE=${snapshot.STAGING_VERIFIED_IMAGE_SOURCE ?? 'unset'})`
    );
  }

  const comparisons = [
    ['Staging verification SHA', expected.EXPECTED_APP_SHA, snapshot.STAGING_VERIFIED_APP_SHA],
    [
      'Verified gateway image',
      expected.EXPECTED_GATEWAY_IMAGE,
      snapshot.STAGING_VERIFIED_GATEWAY_IMAGE,
    ],
    [
      'Verified migrations image',
      expected.EXPECTED_MIGRATIONS_IMAGE,
      snapshot.STAGING_VERIFIED_MIGRATIONS_IMAGE,
    ],
    [
      'Verified OpenPath Firefox assets image',
      expected.EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE,
      snapshot.STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE,
    ],
    [
      'Verified OpenPath API image',
      expected.EXPECTED_OPENPATH_API_IMAGE,
      snapshot.STAGING_VERIFIED_OPENPATH_API_IMAGE,
    ],
    [
      'Verified OpenPath version',
      expected.EXPECTED_OPENPATH_VERSION,
      snapshot.STAGING_VERIFIED_OPENPATH_VERSION,
    ],
    ['Verified SPA image', expected.EXPECTED_SPA_IMAGE, snapshot.STAGING_VERIFIED_SPA_IMAGE],
    [
      'Verified OpenPath Linux agent version',
      expected.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
      snapshot.STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION,
    ],
  ];

  for (const [label, expectedValue, actualValue] of comparisons) {
    if (String(expectedValue ?? '') !== String(actualValue ?? '')) {
      errors.push(`::error::${label} mismatch. expected=${expectedValue} actual=${actualValue}`);
    }
  }

  return errors;
}

export function validateSignedFirefoxReleaseStagingVerification(snapshot) {
  const errors = [];

  if ((snapshot.STAGING_FIREFOX_POLICY_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Firefox policy evidence is missing or failed (STAGING_FIREFOX_POLICY_RESULT=${snapshot.STAGING_FIREFOX_POLICY_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS ?? '') !== 'present') {
    errors.push(
      '::error::Firefox release artifacts were not marked present in staging verification evidence'
    );
  }

  for (const fieldName of [
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_FIREFOX_SIGNATURE_SOURCE',
    'STAGING_FIREFOX_SIGNATURE_STATE',
  ]) {
    if (!snapshot[fieldName]) {
      errors.push(`::error::${fieldName} is missing from release-state evidence`);
    }
  }

  if (
    snapshot.STAGING_FIREFOX_SIGNATURE_SOURCE &&
    snapshot.STAGING_FIREFOX_SIGNATURE_SOURCE !== 'amo'
  ) {
    errors.push(
      `::error::STAGING_FIREFOX_SIGNATURE_SOURCE must be amo (actual=${snapshot.STAGING_FIREFOX_SIGNATURE_SOURCE})`
    );
  }

  if (
    snapshot.STAGING_FIREFOX_SIGNATURE_STATE &&
    snapshot.STAGING_FIREFOX_SIGNATURE_STATE !== 'signed'
  ) {
    errors.push(
      `::error::STAGING_FIREFOX_SIGNATURE_STATE must be signed (actual=${snapshot.STAGING_FIREFOX_SIGNATURE_STATE})`
    );
  }

  return errors;
}

export function validateHighRiskStagingVerification(snapshot) {
  const errors = [];

  if ((snapshot.STAGING_SMOKE_STATUS ?? '') === 'PASS_WITH_FALLBACK') {
    errors.push(
      '::error::PASS_WITH_FALLBACK is not sufficient production evidence for Windows/Firefox delivery changes'
    );
  }

  if ((snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Windows download/bootstrap-assets evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Windows runtime bootstrap canary evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? 'unset'})`
    );
  }

  const expectedAppSha = String(snapshot.STAGING_VERIFIED_APP_SHA ?? '');
  const canaryAppSha = String(snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA ?? '');
  if (!canaryAppSha || canaryAppSha !== expectedAppSha) {
    errors.push(
      `::error::Windows runtime bootstrap canary evidence is not fresh for staged APP_SHA (STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA=${canaryAppSha || 'unset'}; STAGING_VERIFIED_APP_SHA=${expectedAppSha || 'unset'})`
    );
  }

  if ((snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID ?? '') !== 'none') {
    errors.push(
      `::error::Windows runtime bootstrap canary did not reach firefox-extension-ready successfully (STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID=${snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID ?? 'unset'})`
    );
  }

  const linuxBootstrapResult = snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? '';
  const linuxBootstrapBoundary = snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? '';
  const linuxBootstrapAcceptable =
    linuxBootstrapResult === 'success' ||
    (linuxBootstrapResult === 'skipped-lan-staging' &&
      linuxBootstrapBoundary === 'skipped-lan-staging');

  if (!linuxBootstrapAcceptable) {
    errors.push(
      `::error::Linux bootstrap evidence is missing or failed (STAGING_LINUX_BOOTSTRAP_RESULT=${snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? 'unset'}; boundary=${snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? 'unset'})`
    );
  }

  return errors;
}

export function buildStagingReleaseEvidenceOutputs(snapshot) {
  return {
    staging_smoke_result: snapshot.STAGING_SMOKE_RESULT ?? 'unknown',
    staging_smoke_status: snapshot.STAGING_SMOKE_STATUS ?? 'unknown',
    staging_release_gate_result: snapshot.STAGING_RELEASE_GATE_RESULT ?? 'unknown',
    staging_enrollment_download_result: snapshot.STAGING_ENROLLMENT_DOWNLOAD_RESULT ?? 'unknown',
    staging_linux_enrollment_script_result:
      snapshot.STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT ?? 'unknown',
    staging_windows_enrollment_script_result:
      snapshot.STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT ?? 'unknown',
    staging_email_preflight_mode: snapshot.STAGING_EMAIL_PREFLIGHT_MODE ?? 'unknown',
    staging_email_delivery_high_risk: snapshot.STAGING_EMAIL_DELIVERY_HIGH_RISK ?? 'unknown',
    staging_email_preflight_result: snapshot.STAGING_EMAIL_PREFLIGHT_RESULT ?? 'unknown',
    staging_email_preflight_provider: snapshot.STAGING_EMAIL_PREFLIGHT_PROVIDER ?? 'unknown',
    staging_windows_bootstrap_result: snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unknown',
    staging_firefox_policy_result: snapshot.STAGING_FIREFOX_POLICY_RESULT ?? 'unknown',
    staging_windows_bootstrap_canary_result:
      snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT ?? 'unknown',
    staging_windows_bootstrap_canary_app_sha:
      snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA ?? 'unknown',
    staging_windows_bootstrap_canary_run_id:
      snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID ?? 'unknown',
    staging_windows_bootstrap_canary_failure_boundary_id:
      snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID ?? 'unknown',
    staging_windows_bootstrap_canary_failure_boundary_message:
      snapshot.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE ?? 'unknown',
    staging_firefox_extension_id: snapshot.STAGING_FIREFOX_EXTENSION_ID ?? 'unknown',
    staging_firefox_release_version: snapshot.STAGING_FIREFOX_RELEASE_VERSION ?? 'unknown',
    staging_firefox_signature_source: snapshot.STAGING_FIREFOX_SIGNATURE_SOURCE ?? 'unknown',
    staging_firefox_signature_state: snapshot.STAGING_FIREFOX_SIGNATURE_STATE ?? 'unknown',
    staging_firefox_metadata_sha256: snapshot.STAGING_FIREFOX_METADATA_SHA256 ?? 'unknown',
    staging_firefox_xpi_sha256: snapshot.STAGING_FIREFOX_XPI_SHA256 ?? 'unknown',
    staging_linux_bootstrap_result: snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? 'unknown',
    staging_linux_bootstrap_run_id: snapshot.STAGING_LINUX_BOOTSTRAP_RUN_ID ?? 'unknown',
    staging_linux_bootstrap_failure_boundary_id:
      snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? 'unknown',
    staging_linux_bootstrap_failure_boundary_message:
      snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE ?? 'unknown',
    staging_windows_self_update_result: snapshot.STAGING_WINDOWS_SELF_UPDATE_RESULT ?? 'unknown',
    staging_linux_self_update_result: snapshot.STAGING_LINUX_SELF_UPDATE_RESULT ?? 'unknown',
    staging_prepromotion_rehearsal_result:
      snapshot.STAGING_PREPROMOTION_REHEARSAL_RESULT ?? 'unknown',
    staging_verified_at: snapshot.STAGING_VERIFIED_AT ?? 'unknown',
  };
}

/**
 * @param {{
 *   status: 'pass' | 'fail' | 'not_applicable';
 *   errors: string[];
 * }} params
 */
function buildCheck(params) {
  return {
    status: params.status,
    errors: [...params.errors],
  };
}

/**
 * @param {{
 *   deploymentMode: StagingDeploymentMode;
 *   imageSource: 'release-candidate' | 'source-build';
 *   currentState: Record<string, string | undefined>;
 *   verificationState: Record<string, string | undefined>;
 *   expectedRuntime: Record<string, string | undefined>;
 *   highRisk: boolean;
 * }} params
 */
export function evaluatePromotionEligibility({
  deploymentMode,
  imageSource,
  currentState,
  verificationState,
  expectedRuntime,
  highRisk,
}) {
  /** @type {string[]} */
  const deploymentModeErrors = [];

  if (deploymentMode !== PROMOTION_ELIGIBILITY_POLICY.requiredDeploymentMode) {
    deploymentModeErrors.push(
      '::error::Staging deploy is not promotion-eligible. Use release-candidate promotion mode before tagging production.'
    );
  }

  if (imageSource !== PROMOTION_ELIGIBILITY_POLICY.requiredImageSource) {
    deploymentModeErrors.push(
      `::error::Promotion requires immutable release-candidate images (imageSource=${imageSource})`
    );
  }

  const runtimeErrors = validateCurrentReleaseState(currentState, expectedRuntime);
  const verificationErrors = validateStagingVerification(verificationState, expectedRuntime);
  const signedFirefoxReleaseErrors =
    validateSignedFirefoxReleaseStagingVerification(verificationState);
  const windowsFirefoxErrors = highRisk
    ? validateHighRiskStagingVerification(verificationState)
    : [];

  const checks = {
    deploymentMode: buildCheck({
      status: deploymentModeErrors.length === 0 ? 'pass' : 'fail',
      errors: deploymentModeErrors,
    }),
    currentRuntime: buildCheck({
      status: runtimeErrors.length === 0 ? 'pass' : 'fail',
      errors: runtimeErrors,
    }),
    stagingVerification: buildCheck({
      status: verificationErrors.length === 0 ? 'pass' : 'fail',
      errors: verificationErrors,
    }),
    signedFirefoxRelease: buildCheck({
      status: signedFirefoxReleaseErrors.length === 0 ? 'pass' : 'fail',
      errors: signedFirefoxReleaseErrors,
    }),
    windowsFirefox: highRisk
      ? buildCheck({
          status: windowsFirefoxErrors.length === 0 ? 'pass' : 'fail',
          errors: windowsFirefoxErrors,
        })
      : buildCheck({
          status: 'not_applicable',
          errors: [],
        }),
  };

  const errors = [
    ...checks.deploymentMode.errors,
    ...checks.currentRuntime.errors,
    ...checks.stagingVerification.errors,
    ...checks.signedFirefoxRelease.errors,
    ...checks.windowsFirefox.errors,
  ];

  return {
    version: 1,
    eligible: errors.length === 0,
    deploymentMode,
    imageSource,
    highRisk,
    checks,
    errors,
    outputs: buildStagingReleaseEvidenceOutputs(verificationState),
  };
}

/**
 * @param {ReturnType<typeof evaluatePromotionEligibility>} report
 */
export function buildPromotionEligibilityOutputs(report) {
  return {
    promotion_eligible: report.eligible ? 'true' : 'false',
    promotion_deployment_mode: report.deploymentMode,
    ...report.outputs,
  };
}

export function deriveAdvisoryCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  return valueOrNull(canaryResult) ?? 'not_run';
}

export function derivePostReleaseCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  const normalized = valueOrNull(canaryResult);
  if (!normalized) {
    return 'pending-post-release';
  }

  if (
    Object.prototype.hasOwnProperty.call(RELEASE_JOB_RESULT_POLICY.postReleaseAliases, normalized)
  ) {
    return RELEASE_JOB_RESULT_POLICY.postReleaseAliases[normalized];
  }

  if (
    normalized === 'live-tested' ||
    normalized === 'skipped-by-billing-mode' ||
    normalized === 'advisory-only' ||
    normalized === 'failed'
  ) {
    return normalized;
  }

  return normalized;
}

export function normalizeReusableCanaryJobResult({ canaryResult, jobResult, pendingResult }) {
  const normalizedJobResult = valueOrNull(jobResult);
  if (
    normalizedJobResult &&
    !RELEASE_JOB_RESULT_POLICY.ignoredReusableJobResults.includes(normalizedJobResult)
  ) {
    return normalizedJobResult;
  }

  return valueOrNull(canaryResult) ?? pendingResult;
}

export function deriveProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  return normalizeReusableCanaryJobResult({
    canaryResult,
    jobResult,
    pendingResult: 'pending-post-release',
  });
}

export function deriveLinuxProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult }) {
  return deriveProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult });
}

function firstValue(...values) {
  for (const value of values) {
    const normalized = valueOrNull(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function includesArtifactEvidence(result) {
  return RELEASE_JOB_RESULT_POLICY.evidenceBearingResults.includes(result);
}

export function formatDurationSeconds(seconds) {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds) || numericSeconds < 0) {
    return 'n/a';
  }

  const totalSeconds = Math.round(numericSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`
    : `${remainingSeconds}s`;
}

export const RELEASE_TIMING_JOB_KEYS = new Map([
  ['Verify OpenPath Upstream Checks', 'verifyOpenPathUpstream'],
  ['Verify OpenPath Upstream', 'verifyOpenPathUpstream'],
  ['Resolve Release Images', 'resolveReleaseImages'],
  ['Verify Staging Release State', 'verifyStagingReleaseState'],
  ['Windows Firefox Canary', 'windowsFirefoxCanary'],
  ['Deploy to Production', 'deployProduction'],
  ['Smoke Test Production', 'smokeTestProduction'],
  ['Windows Production Bootstrap Canary', 'windowsProductionBootstrapCanary'],
  ['Linux Production Bootstrap Canary', 'linuxProductionBootstrapCanary'],
  ['Release Evidence', 'releaseEvidence'],
]);

function timingJobDuration(job = {}) {
  if (job.executionSeconds === null || job.executionSeconds === undefined) {
    return null;
  }

  return { durationMs: Number(job.executionSeconds) * 1000 };
}

export function buildReleaseTimingEvidence(summary = {}) {
  const jobs = {};

  for (const job of summary.jobs ?? []) {
    const key = RELEASE_TIMING_JOB_KEYS.get(String(job.name ?? ''));
    const duration = timingJobDuration(job);

    if (key && duration) {
      jobs[key] = duration;
    }
  }

  return {
    totalWallSeconds: summary.totals?.wallSeconds ?? null,
    criticalPath: summary.criticalPath ?? null,
    jobs,
  };
}

export function readReleaseTimingEvidence(env) {
  if (env.timings) {
    return env.timings;
  }

  const timingSummaryPath = valueOrNull(env.RUN_TIMING_SUMMARY_PATH);
  if (!timingSummaryPath) {
    return null;
  }

  try {
    return buildReleaseTimingEvidence(JSON.parse(readFileSync(timingSummaryPath, 'utf8')));
  } catch {
    return null;
  }
}

export function deriveReleaseOutcome({ deployResult, smokeResult, rollbackResult }) {
  if (smokeResult === 'success') {
    return 'released';
  }

  if (rollbackResult === 'success') {
    return 'rolled_back_after_failed_smoke';
  }

  if (deployResult === 'failure') {
    return 'deployment_failed';
  }

  if (deployResult === 'success' && smokeResult !== 'success') {
    return 'deployed_without_passing_smoke';
  }

  return 'blocked_before_deploy';
}

export function derivePromotionEligibility(env) {
  const rawEligible = valueOrNull(env.PROMOTION_ELIGIBLE);
  const fallbackEligible =
    valueOrNull(env.VERIFY_STAGING_RESULT) === 'success' &&
    valueOrNull(env.STAGING_SMOKE_RESULT) === 'success' &&
    valueOrNull(env.STAGING_RELEASE_GATE_RESULT) === 'success' &&
    valueOrNull(env.STAGING_ENROLLMENT_DOWNLOAD_RESULT) === 'success' &&
    valueOrNull(env.STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT) === 'success' &&
    valueOrNull(env.STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT) === 'success';
  const deploymentMode =
    valueOrNull(env.PROMOTION_DEPLOYMENT_MODE) ??
    (valueOrNull(env.STAGING_VERIFIED_IMAGE_SOURCE) === 'source-build'
      ? 'debug'
      : fallbackEligible
        ? 'promotion-eligible'
        : null);

  return {
    status:
      rawEligible === 'true'
        ? 'eligible'
        : rawEligible === 'false'
          ? 'ineligible'
          : fallbackEligible
            ? 'eligible'
            : 'unknown',
    deploymentMode,
  };
}

/**
 * @param {ReleaseEvidenceInput | NodeJS.ProcessEnv} input
 */
export function createReleaseEvidenceSnapshot(input = process.env) {
  if (input?.release && typeof input.release === 'object') {
    return normalizeReleaseEvidenceSnapshot(/** @type {SnapshotRecord} */ (input));
  }

  const env = /** @type {NodeJS.ProcessEnv} */ (input);
  const windowsFirefoxHighRisk = isTrueFlag(env.STAGING_WINDOWS_FIREFOX_HIGH_RISK);
  const promotionEligibility = derivePromotionEligibility(env);
  const preproductionWindowsBootstrapCanary = deriveProductionBootstrapCanaryResult({
    highRisk: windowsFirefoxHighRisk,
    canaryResult: firstValue(
      env.PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_RESULT,
      env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT
    ),
    jobResult: firstValue(
      env.PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_JOB_RESULT,
      env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT
    ),
  });
  const hasLiveWindowsProductionBootstrapInput =
    valueOrNull(env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT) ||
    valueOrNull(env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT);
  const windowsProductionBootstrapCanary = hasLiveWindowsProductionBootstrapInput
    ? deriveProductionBootstrapCanaryResult({
        highRisk: windowsFirefoxHighRisk,
        canaryResult: env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT,
        jobResult: env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT,
      })
    : null;
  const linuxProductionBootstrapCanary = deriveLinuxProductionBootstrapCanaryResult({
    highRisk: windowsFirefoxHighRisk,
    canaryResult: env.LINUX_PRODUCTION_BOOTSTRAP_CANARY_RESULT,
    jobResult: env.LINUX_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT,
  });

  return normalizeReleaseEvidenceSnapshot({
    generatedAt: new Date().toISOString(),
    repository: valueOrNull(env.GITHUB_REPOSITORY),
    workflowRunId: valueOrNull(env.GITHUB_RUN_ID),
    workflowRunUrl:
      valueOrNull(env.GITHUB_SERVER_URL) &&
      valueOrNull(env.GITHUB_REPOSITORY) &&
      valueOrNull(env.GITHUB_RUN_ID)
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    release: {
      tagName: valueOrNull(env.TAG_NAME),
      classroomPathSha: valueOrNull(env.APP_SHA),
      openPathSha: valueOrNull(env.OPENPATH_SHA),
      outcome: deriveReleaseOutcome({
        deployResult: valueOrNull(env.DEPLOY_RESULT),
        smokeResult: valueOrNull(env.PRODUCTION_SMOKE_RESULT),
        rollbackResult: valueOrNull(env.ROLLBACK_RESULT),
      }),
    },
    promotionEligibility,
    transparency: {
      localVerification: {
        source: 'developer-machine explicit verification',
        reproducedInGitHubActions: false,
        note: 'Pre-commit is a fast local guard; GitHub Actions reuses staging verification evidence for the tagged SHA instead of rerunning the same staging gate during production promotion.',
      },
    },
    targets: {
      staging: {
        publicUrl: valueOrNull(env.STAGING_URL),
        gatewayHealthUrl: valueOrNull(env.STAGING_GATEWAY_HEALTH_URL),
        readyUrl: valueOrNull(env.STAGING_READY_URL),
        apiConfigUrl: valueOrNull(env.STAGING_API_CONFIG_URL),
      },
      production: {
        publicUrl: valueOrNull(env.PRODUCTION_URL),
        gatewayHealthUrl: valueOrNull(env.PRODUCTION_GATEWAY_HEALTH_URL),
        readyUrl: valueOrNull(env.PRODUCTION_READY_URL),
        apiConfigUrl: valueOrNull(env.PRODUCTION_API_CONFIG_URL),
      },
    },
    jobs: {
      verifyOpenPathUpstream: valueOrNull(env.VERIFY_OPENPATH_RESULT),
      resolveReleaseImages: valueOrNull(env.RESOLVE_IMAGES_RESULT),
      verifyStagingReleaseState: valueOrNull(env.VERIFY_STAGING_RESULT),
      windowsFirefoxCanary: deriveAdvisoryCanaryResult({
        highRisk: windowsFirefoxHighRisk,
        canaryResult: env.WINDOWS_FIREFOX_CANARY_RESULT,
      }),
      preproductionWindowsBootstrapCanary,
      windowsProductionBootstrapCanary,
      linuxProductionBootstrapCanary,
      productionClientUpdateCanary: derivePostReleaseCanaryResult({
        highRisk: windowsFirefoxHighRisk,
        canaryResult: env.PRODUCTION_CLIENT_UPDATE_CANARY_RESULT,
      }),
      deployProduction: valueOrNull(env.DEPLOY_RESULT),
      smokeTestProduction: valueOrNull(env.PRODUCTION_SMOKE_RESULT),
      rollbackProduction: valueOrNull(env.ROLLBACK_RESULT),
    },
    diagnostics: {
      preproductionWindowsBootstrapFailureBoundary: {
        id: firstValue(
          env.PREPRODUCTION_WINDOWS_BOOTSTRAP_FAILURE_BOUNDARY_ID,
          env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID
        ),
        message: firstValue(
          env.PREPRODUCTION_WINDOWS_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE,
          env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE
        ),
      },
      windowsProductionBootstrapFailureBoundary: {
        id: valueOrNull(env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID),
        message: valueOrNull(env.LIVE_WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE),
      },
      linuxProductionBootstrapFailureBoundary: {
        id: valueOrNull(env.LINUX_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID),
        message: valueOrNull(env.LINUX_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE),
      },
    },
    stagingVerification: {
      smokeResult: valueOrNull(env.STAGING_SMOKE_RESULT),
      smokeStatus: valueOrNull(env.STAGING_SMOKE_STATUS),
      releaseGateResult: valueOrNull(env.STAGING_RELEASE_GATE_RESULT),
      enrollmentDownloadResult: valueOrNull(env.STAGING_ENROLLMENT_DOWNLOAD_RESULT),
      linuxEnrollmentScriptResult: valueOrNull(env.STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT),
      windowsEnrollmentScriptResult: valueOrNull(env.STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT),
      windowsFirefoxHighRisk: windowsFirefoxHighRisk ? 'true' : 'false',
      windowsBootstrapResult: valueOrNull(env.STAGING_WINDOWS_BOOTSTRAP_RESULT),
      firefoxPolicyResult: valueOrNull(env.STAGING_FIREFOX_POLICY_RESULT),
      linuxBootstrapResult: valueOrNull(env.STAGING_LINUX_BOOTSTRAP_RESULT),
      linuxBootstrapRunId: valueOrNull(env.STAGING_LINUX_BOOTSTRAP_RUN_ID),
      linuxBootstrapFailureBoundaryId: valueOrNull(env.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID),
      linuxBootstrapFailureBoundaryMessage: valueOrNull(
        env.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE
      ),
      windowsSelfUpdateResult: valueOrNull(env.STAGING_WINDOWS_SELF_UPDATE_RESULT),
      linuxSelfUpdateResult: valueOrNull(env.STAGING_LINUX_SELF_UPDATE_RESULT),
      prepromotionRehearsalResult: valueOrNull(env.STAGING_PREPROMOTION_REHEARSAL_RESULT),
      verifiedAt: valueOrNull(env.STAGING_VERIFIED_AT),
    },
    immutableImages: {
      gateway: valueOrNull(env.GATEWAY_IMAGE),
      migrations: valueOrNull(env.MIGRATIONS_IMAGE),
      openPathFirefoxAssets: valueOrNull(env.OPENPATH_FIREFOX_ASSETS_IMAGE),
      openPathApi: valueOrNull(env.OPENPATH_API_IMAGE),
      spa: valueOrNull(env.SPA_IMAGE),
      verifier: valueOrNull(env.VERIFIER_IMAGE),
    },
    artifacts: {
      releaseImageMetadata: valueOrNull(env.TAG_NAME)
        ? `release-image-metadata-${env.TAG_NAME}`
        : null,
      stagingReleaseState: valueOrNull(env.TAG_NAME)
        ? `staging-release-state-${env.TAG_NAME}`
        : null,
      productionSmokeResults: 'smoke-test-results-production',
      preproductionWindowsBootstrapCanary: includesArtifactEvidence(
        preproductionWindowsBootstrapCanary
      )
        ? PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT
        : null,
      windowsProductionBootstrapCanary: includesArtifactEvidence(windowsProductionBootstrapCanary)
        ? WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT
        : null,
      linuxProductionBootstrapCanary: includesArtifactEvidence(linuxProductionBootstrapCanary)
        ? LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT
        : null,
      releaseEvidence: valueOrNull(env.TAG_NAME)
        ? `release-evidence-${env.TAG_NAME}`
        : 'release-evidence',
    },
    artifactIntegrity: env.artifactIntegrity ?? null,
    canaries: env.canaries ?? null,
    production: env.production ?? null,
    timings: readReleaseTimingEvidence(env),
  });
}

/**
 * @param {SnapshotRecord} snapshot
 */
export function normalizeReleaseEvidenceSnapshot(snapshot) {
  return {
    generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
    repository: snapshot.repository ?? null,
    workflowRunId: snapshot.workflowRunId ?? null,
    workflowRunUrl: snapshot.workflowRunUrl ?? null,
    release: {
      tagName: snapshot.release?.tagName ?? null,
      classroomPathSha: snapshot.release?.classroomPathSha ?? null,
      openPathSha: snapshot.release?.openPathSha ?? null,
      outcome: snapshot.release?.outcome ?? 'unknown',
    },
    promotionEligibility: {
      status: snapshot.promotionEligibility?.status ?? 'unknown',
      deploymentMode: snapshot.promotionEligibility?.deploymentMode ?? null,
    },
    transparency: snapshot.transparency ?? null,
    targets: {
      staging: snapshot.targets?.staging ?? {},
      production: snapshot.targets?.production ?? {},
    },
    jobs: {
      verifyOpenPathUpstream: snapshot.jobs?.verifyOpenPathUpstream ?? null,
      resolveReleaseImages: snapshot.jobs?.resolveReleaseImages ?? null,
      verifyStagingReleaseState: snapshot.jobs?.verifyStagingReleaseState ?? null,
      windowsFirefoxCanary: snapshot.jobs?.windowsFirefoxCanary ?? null,
      preproductionWindowsBootstrapCanary:
        snapshot.jobs?.preproductionWindowsBootstrapCanary ??
        snapshot.jobs?.windowsProductionBootstrapCanary ??
        null,
      windowsProductionBootstrapCanary: snapshot.jobs?.windowsProductionBootstrapCanary ?? null,
      linuxProductionBootstrapCanary: snapshot.jobs?.linuxProductionBootstrapCanary ?? null,
      productionClientUpdateCanary: snapshot.jobs?.productionClientUpdateCanary ?? null,
      deployProduction: snapshot.jobs?.deployProduction ?? null,
      smokeTestProduction: snapshot.jobs?.smokeTestProduction ?? null,
      rollbackProduction: snapshot.jobs?.rollbackProduction ?? null,
    },
    diagnostics: {
      preproductionWindowsBootstrapFailureBoundary: snapshot.diagnostics
        ?.preproductionWindowsBootstrapFailureBoundary ??
        snapshot.diagnostics?.windowsProductionBootstrapFailureBoundary ?? {
          id: null,
          message: null,
        },
      windowsProductionBootstrapFailureBoundary: snapshot.diagnostics
        ?.windowsProductionBootstrapFailureBoundary ?? {
        id: null,
        message: null,
      },
      linuxProductionBootstrapFailureBoundary: snapshot.diagnostics
        ?.linuxProductionBootstrapFailureBoundary ?? {
        id: null,
        message: null,
      },
    },
    stagingVerification: {
      smokeResult: snapshot.stagingVerification?.smokeResult ?? null,
      smokeStatus: snapshot.stagingVerification?.smokeStatus ?? null,
      releaseGateResult: snapshot.stagingVerification?.releaseGateResult ?? null,
      enrollmentDownloadResult: snapshot.stagingVerification?.enrollmentDownloadResult ?? null,
      linuxEnrollmentScriptResult:
        snapshot.stagingVerification?.linuxEnrollmentScriptResult ?? null,
      windowsEnrollmentScriptResult:
        snapshot.stagingVerification?.windowsEnrollmentScriptResult ?? null,
      windowsFirefoxHighRisk: snapshot.stagingVerification?.windowsFirefoxHighRisk ?? null,
      windowsBootstrapResult: snapshot.stagingVerification?.windowsBootstrapResult ?? null,
      firefoxPolicyResult: snapshot.stagingVerification?.firefoxPolicyResult ?? null,
      linuxBootstrapResult: snapshot.stagingVerification?.linuxBootstrapResult ?? null,
      linuxBootstrapRunId: snapshot.stagingVerification?.linuxBootstrapRunId ?? null,
      linuxBootstrapFailureBoundaryId:
        snapshot.stagingVerification?.linuxBootstrapFailureBoundaryId ?? null,
      linuxBootstrapFailureBoundaryMessage:
        snapshot.stagingVerification?.linuxBootstrapFailureBoundaryMessage ?? null,
      windowsSelfUpdateResult: snapshot.stagingVerification?.windowsSelfUpdateResult ?? null,
      linuxSelfUpdateResult: snapshot.stagingVerification?.linuxSelfUpdateResult ?? null,
      prepromotionRehearsalResult:
        snapshot.stagingVerification?.prepromotionRehearsalResult ?? null,
      verifiedAt: snapshot.stagingVerification?.verifiedAt ?? null,
    },
    immutableImages: {
      gateway: snapshot.immutableImages?.gateway ?? null,
      migrations: snapshot.immutableImages?.migrations ?? null,
      openPathFirefoxAssets: snapshot.immutableImages?.openPathFirefoxAssets ?? null,
      openPathApi: snapshot.immutableImages?.openPathApi ?? null,
      spa: snapshot.immutableImages?.spa ?? null,
      verifier: snapshot.immutableImages?.verifier ?? null,
    },
    artifacts: {
      releaseImageMetadata: snapshot.artifacts?.releaseImageMetadata ?? null,
      stagingReleaseState: snapshot.artifacts?.stagingReleaseState ?? null,
      productionSmokeResults: snapshot.artifacts?.productionSmokeResults ?? null,
      preproductionWindowsBootstrapCanary:
        snapshot.artifacts?.preproductionWindowsBootstrapCanary ??
        snapshot.artifacts?.windowsProductionBootstrapCanary ??
        null,
      windowsProductionBootstrapCanary:
        snapshot.artifacts?.windowsProductionBootstrapCanary ?? null,
      linuxProductionBootstrapCanary: snapshot.artifacts?.linuxProductionBootstrapCanary ?? null,
      releaseEvidence: snapshot.artifacts?.releaseEvidence ?? null,
    },
    artifactIntegrity: snapshot.artifactIntegrity ?? null,
    canaries: snapshot.canaries ?? null,
    production: snapshot.production ?? null,
    timings: snapshot.timings ?? null,
  };
}

export function validateReleaseEvidenceSnapshot(snapshot) {
  const errors = [];

  for (const [path, value] of [
    ['release', snapshot.release],
    ['promotionEligibility', snapshot.promotionEligibility],
    ['jobs', snapshot.jobs],
    ['diagnostics', snapshot.diagnostics],
    ['stagingVerification', snapshot.stagingVerification],
    ['targets', snapshot.targets],
    ['immutableImages', snapshot.immutableImages],
    ['artifacts', snapshot.artifacts],
  ]) {
    if (!value || typeof value !== 'object') {
      errors.push(`${path} must be an object`);
    }
  }

  if (!snapshot.release?.outcome) {
    errors.push('release.outcome missing');
  }

  if (!snapshot.promotionEligibility?.status) {
    errors.push('promotionEligibility.status missing');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function serializeReleaseEvidenceSnapshot(input = process.env) {
  const snapshot = createReleaseEvidenceSnapshot(input);
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function projectReleaseEvidenceSnapshotToWorkflowOutputs(input = process.env) {
  const snapshot = createReleaseEvidenceSnapshot(input);

  return {
    release_outcome: snapshot.release.outcome ?? 'unknown',
    release_tag_name: snapshot.release.tagName ?? 'unknown',
    release_classroompath_sha: snapshot.release.classroomPathSha ?? 'unknown',
    release_openpath_sha: snapshot.release.openPathSha ?? 'unknown',
    release_promotion_eligibility: snapshot.promotionEligibility.status ?? 'unknown',
    release_promotion_deployment_mode: snapshot.promotionEligibility.deploymentMode ?? 'unknown',
  };
}

export const buildReleaseEvidenceSnapshot = createReleaseEvidenceSnapshot;
