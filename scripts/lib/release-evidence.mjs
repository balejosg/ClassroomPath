// @ts-check

import { readFileSync } from 'node:fs';

import {
  LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  isTrueFlag,
  valueOrNull,
} from './release-evidence-contract.mjs';

export const STAGING_DEPLOYMENT_MODES = /** @type {const} */ (['promotion-eligible', 'debug']);

/**
 * @typedef {'promotion-eligible' | 'debug'} StagingDeploymentMode
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

  if ((snapshot.IMAGE_SOURCE ?? '') !== 'release-candidate') {
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
      `::error::Windows bootstrap evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unset'})`
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
    staging_email_preflight_mode: snapshot.STAGING_EMAIL_PREFLIGHT_MODE ?? 'unknown',
    staging_email_delivery_high_risk: snapshot.STAGING_EMAIL_DELIVERY_HIGH_RISK ?? 'unknown',
    staging_email_preflight_result: snapshot.STAGING_EMAIL_PREFLIGHT_RESULT ?? 'unknown',
    staging_email_preflight_provider: snapshot.STAGING_EMAIL_PREFLIGHT_PROVIDER ?? 'unknown',
    staging_windows_bootstrap_result: snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unknown',
    staging_firefox_policy_result: snapshot.STAGING_FIREFOX_POLICY_RESULT ?? 'unknown',
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

  if (deploymentMode !== 'promotion-eligible') {
    deploymentModeErrors.push(
      '::error::Staging deploy is not promotion-eligible. Use release-candidate promotion mode before tagging production.'
    );
  }

  if (imageSource !== 'release-candidate') {
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

function deriveAdvisoryCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  return valueOrNull(canaryResult) ?? 'not_run';
}

function derivePostReleaseCanaryResult({ highRisk, canaryResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  const normalized = valueOrNull(canaryResult);
  if (!normalized) {
    return 'pending-post-release';
  }

  if (normalized === 'success') {
    return 'live-tested';
  }

  if (normalized === 'failure') {
    return 'failed';
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

function deriveProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult }) {
  if (!highRisk) {
    return 'not_applicable';
  }

  const normalizedJobResult = valueOrNull(jobResult);
  if (
    normalizedJobResult &&
    normalizedJobResult !== 'success' &&
    normalizedJobResult !== 'skipped'
  ) {
    return normalizedJobResult;
  }

  return valueOrNull(canaryResult) ?? 'pending-post-release';
}

function deriveLinuxProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult }) {
  return deriveProductionBootstrapCanaryResult({ highRisk, canaryResult, jobResult });
}

function includesArtifactEvidence(result) {
  return result === 'success' || result === 'failure' || result === 'failed';
}

function markdownCell(value) {
  return String(value ?? 'n/a')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function summaryCell(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return 'unknown';
  }

  return raw
    .replace(/https?:\/\/([^/\s:@]+):([^@\s/]+)@/gi, 'https://[redacted]@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(token|secret|password|key)=([^\s&|]+)/gi, '$1=[redacted]')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|');
}

function canarySummaryRow(label, canary = {}) {
  return `| ${summaryCell(label)} | ${summaryCell(canary.result)} | ${summaryCell(canary.boundaryId)} | ${summaryCell(canary.message)} |`;
}

function summaryValue(value) {
  return value === 'n/a' ? undefined : value;
}

export function renderCanaryBoundarySummary({ linux = {}, windows = {} } = {}) {
  return [
    '## Release Canary Boundary',
    '',
    '| Canary | Result | Boundary | Message |',
    '| --- | --- | --- | --- |',
    canarySummaryRow('Linux bootstrap/AJAX', linux),
    canarySummaryRow('Windows bootstrap/AJAX', windows),
    '',
  ].join('\n');
}

function formatDuration(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  const durationMs = Number(value?.durationMs ?? value?.elapsedMs ?? value);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'n/a';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function formatDurationSeconds(seconds) {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds) || numericSeconds < 0) {
    return 'n/a';
  }

  return formatDuration({ durationMs: numericSeconds * 1000 });
}

function timingJobLabel(job) {
  return job?.name ? String(job.name) : 'n/a';
}

function timingJobMetricSeconds(job, metric) {
  const seconds = Number(job?.[metric]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function timingJobDurationLabel(job, metric) {
  const seconds = timingJobMetricSeconds(job, metric);
  return seconds === null ? 'n/a' : formatDurationSeconds(seconds);
}

function renderReleaseTimingMarkdown(timings = null) {
  if (!timings) {
    return [];
  }

  const criticalPath = timings.criticalPath ?? {};
  const criticalPathJobs = (criticalPath.jobs ?? []).map((job) => timingJobLabel(job));

  return [
    '### Release Timing',
    '',
    `- Staging-to-production duration: \`${formatDurationSeconds(timings.totalWallSeconds)}\``,
    `- Top queue blocker: \`${timingJobLabel(criticalPath.longestQueueJob)}\` (\`${timingJobDurationLabel(criticalPath.longestQueueJob, 'queueSeconds')}\`)`,
    `- Top execution blocker: \`${timingJobLabel(criticalPath.longestExecutionJob)}\` (\`${timingJobDurationLabel(criticalPath.longestExecutionJob, 'executionSeconds')}\`)`,
    `- Critical path: \`${criticalPathJobs.length > 0 ? criticalPathJobs.join(' -> ') : 'n/a'}\``,
    '',
  ];
}

const RELEASE_TIMING_JOB_KEYS = new Map([
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

function buildReleaseTimingEvidence(summary = {}) {
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

function readReleaseTimingEvidence(env) {
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

function renderDashboardStatusRow({
  label,
  result,
  boundary = 'n/a',
  duration = 'n/a',
  evidence = 'n/a',
}) {
  return `| ${markdownCell(label)} | ${markdownCell(result)} | ${markdownCell(boundary)} | ${markdownCell(formatDuration(duration))} | ${markdownCell(evidence)} |`;
}

function renderReleaseDashboardMarkdown({
  evidence,
  windowsFailureBoundary,
  linuxFailureBoundary,
}) {
  const timings = evidence.timings?.jobs ?? {};

  return [
    '## Release Dashboard',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Tag | \`${markdownCell(evidence.release.tagName ?? 'n/a')}\` |`,
    `| Outcome | \`${markdownCell(evidence.release.outcome ?? 'n/a')}\` |`,
    `| ClassroomPath SHA | \`${markdownCell(evidence.release.classroomPathSha ?? 'n/a')}\` |`,
    `| OpenPath SHA | \`${markdownCell(evidence.release.openPathSha ?? 'n/a')}\` |`,
    `| Promotion eligibility | \`${markdownCell(evidence.promotionEligibility.status ?? 'n/a')}\` |`,
    evidence.workflowRunUrl
      ? `| Workflow run | ${markdownCell(evidence.workflowRunUrl)} |`
      : '| Workflow run | n/a |',
    '',
    '| Signal | Result | Boundary | Duration | Evidence |',
    '| --- | --- | --- | --- | --- |',
    renderDashboardStatusRow({
      label: 'Staging evidence',
      result: evidence.jobs.verifyStagingReleaseState ?? 'n/a',
      duration: timings.verifyStagingReleaseState,
      evidence: evidence.artifacts.stagingReleaseState ?? 'n/a',
    }),
    renderDashboardStatusRow({
      label: 'Deploy production',
      result: evidence.jobs.deployProduction ?? 'n/a',
      duration: timings.deployProduction,
      evidence: evidence.workflowRunUrl ?? 'n/a',
    }),
    renderDashboardStatusRow({
      label: 'Production smoke',
      result: evidence.jobs.smokeTestProduction ?? 'n/a',
      duration: timings.smokeTestProduction,
      evidence: evidence.artifacts.productionSmokeResults ?? 'n/a',
    }),
    renderDashboardStatusRow({
      label: 'Windows production bootstrap canary',
      result: evidence.jobs.windowsProductionBootstrapCanary ?? 'n/a',
      boundary: windowsFailureBoundary,
      duration: timings.windowsProductionBootstrapCanary,
      evidence: evidence.artifacts.windowsProductionBootstrapCanary ?? 'n/a',
    }),
    renderDashboardStatusRow({
      label: 'Linux production bootstrap canary',
      result: evidence.jobs.linuxProductionBootstrapCanary ?? 'n/a',
      boundary: linuxFailureBoundary,
      duration: timings.linuxProductionBootstrapCanary,
      evidence: evidence.artifacts.linuxProductionBootstrapCanary ?? 'n/a',
    }),
    renderDashboardStatusRow({
      label: 'Release evidence',
      result: evidence.artifacts.releaseEvidence ? 'published' : 'n/a',
      duration: timings.releaseEvidence,
      evidence: evidence.artifacts.releaseEvidence ?? 'n/a',
    }),
    '',
    ...renderReleaseTimingMarkdown(evidence.timings),
  ];
}

function deriveReleaseOutcome({ deployResult, smokeResult, rollbackResult }) {
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

function derivePromotionEligibility(env) {
  const rawEligible = valueOrNull(env.PROMOTION_ELIGIBLE);
  const fallbackEligible =
    valueOrNull(env.VERIFY_STAGING_RESULT) === 'success' &&
    valueOrNull(env.STAGING_SMOKE_RESULT) === 'success' &&
    valueOrNull(env.STAGING_RELEASE_GATE_RESULT) === 'success';
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

export function buildReleaseEvidence(env = process.env) {
  const windowsFirefoxHighRisk = isTrueFlag(env.STAGING_WINDOWS_FIREFOX_HIGH_RISK);
  const promotionEligibility = derivePromotionEligibility(env);
  const windowsProductionBootstrapCanary = deriveProductionBootstrapCanaryResult({
    highRisk: windowsFirefoxHighRisk,
    canaryResult: env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT,
    jobResult: env.WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT,
  });
  const linuxProductionBootstrapCanary = deriveLinuxProductionBootstrapCanaryResult({
    highRisk: windowsFirefoxHighRisk,
    canaryResult: env.LINUX_PRODUCTION_BOOTSTRAP_CANARY_RESULT,
    jobResult: env.LINUX_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT,
  });

  return {
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
      windowsProductionBootstrapFailureBoundary: {
        id: valueOrNull(env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID),
        message: valueOrNull(env.WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE),
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
  };
}

export function renderReleaseEvidenceMarkdown(evidence) {
  const windowsArtifactIntegrity =
    evidence.artifactIntegrity?.windowsProductionBootstrapCanary?.status ?? 'n/a';
  const linuxArtifactIntegrity =
    evidence.artifactIntegrity?.linuxProductionBootstrapCanary?.status ?? 'n/a';
  const windowsFailureBoundary =
    evidence.canaries?.windows?.failureBoundary?.id ??
    evidence.diagnostics.windowsProductionBootstrapFailureBoundary.id ??
    'n/a';
  const windowsFailureBoundaryMessage =
    evidence.canaries?.windows?.failureBoundary?.message ??
    evidence.diagnostics.windowsProductionBootstrapFailureBoundary.message ??
    'n/a';
  const linuxFailureBoundary =
    evidence.canaries?.linux?.failureBoundary?.id ??
    evidence.diagnostics.linuxProductionBootstrapFailureBoundary.id ??
    'n/a';
  const linuxFailureBoundaryMessage =
    evidence.canaries?.linux?.failureBoundary?.message ??
    evidence.diagnostics.linuxProductionBootstrapFailureBoundary.message ??
    'n/a';
  const windowsCanaryTargetUrl = evidence.canaries?.windows?.targetUrl ?? 'n/a';
  const linuxCanaryTargetUrl = evidence.canaries?.linux?.targetUrl ?? 'n/a';

  return [
    ...renderReleaseDashboardMarkdown({
      evidence,
      windowsFailureBoundary,
      linuxFailureBoundary,
    }),
    renderCanaryBoundarySummary({
      linux: {
        result: evidence.jobs.linuxProductionBootstrapCanary,
        boundaryId: summaryValue(linuxFailureBoundary),
        message: summaryValue(linuxFailureBoundaryMessage),
      },
      windows: {
        result: evidence.jobs.windowsProductionBootstrapCanary,
        boundaryId: summaryValue(windowsFailureBoundary),
        message: summaryValue(windowsFailureBoundaryMessage),
      },
    }),
    '## Release Evidence',
    '',
    `- Outcome: \`${evidence.release.outcome}\``,
    `- Tag: \`${evidence.release.tagName ?? 'n/a'}\``,
    `- ClassroomPath SHA: \`${evidence.release.classroomPathSha ?? 'n/a'}\``,
    `- OpenPath SHA: \`${evidence.release.openPathSha ?? 'n/a'}\``,
    `- Promotion eligibility: \`${evidence.promotionEligibility.status}\``,
    `- Deployment mode: \`${evidence.promotionEligibility.deploymentMode ?? 'n/a'}\``,
    evidence.workflowRunUrl ? `- Workflow run: ${evidence.workflowRunUrl}` : '- Workflow run: n/a',
    '',
    '| Gate | Result |',
    '| --- | --- |',
    `| Verify OpenPath upstream | ${evidence.jobs.verifyOpenPathUpstream ?? 'n/a'} |`,
    `| Resolve release images | ${evidence.jobs.resolveReleaseImages ?? 'n/a'} |`,
    `| Verify staging release state | ${evidence.jobs.verifyStagingReleaseState ?? 'n/a'} |`,
    `| Windows/Firefox canary (advisory) | ${evidence.jobs.windowsFirefoxCanary ?? 'n/a'} |`,
    `| Windows production bootstrap canary | ${evidence.jobs.windowsProductionBootstrapCanary ?? 'n/a'} |`,
    `| Linux production bootstrap canary | ${evidence.jobs.linuxProductionBootstrapCanary ?? 'n/a'} |`,
    `| Production client update canary (post-release) | ${evidence.jobs.productionClientUpdateCanary ?? 'n/a'} |`,
    `| Deploy production | ${evidence.jobs.deployProduction ?? 'n/a'} |`,
    `| Production smoke | ${evidence.jobs.smokeTestProduction ?? 'n/a'} |`,
    `| Rollback | ${evidence.jobs.rollbackProduction ?? 'n/a'} |`,
    '',
    '### Artifact Integrity',
    '',
    `- Windows canary artifact integrity: \`${windowsArtifactIntegrity}\``,
    `- Linux canary artifact integrity: \`${linuxArtifactIntegrity}\``,
    '',
    '### Windows Bootstrap Diagnostic Boundary',
    '',
    `- Windows bootstrap failure boundary: \`${windowsFailureBoundary}\``,
    `- Boundary message: ${windowsFailureBoundaryMessage}`,
    `- Windows target URL: ${windowsCanaryTargetUrl}`,
    `- Linux bootstrap failure boundary: \`${linuxFailureBoundary}\``,
    `- Linux boundary message: ${linuxFailureBoundaryMessage}`,
    `- Linux target URL: ${linuxCanaryTargetUrl}`,
    '',
    '### Staging Verification Evidence',
    '',
    `- Smoke result: \`${evidence.stagingVerification.smokeResult ?? 'n/a'}\``,
    `- Smoke status: \`${evidence.stagingVerification.smokeStatus ?? 'n/a'}\``,
    `- Release gate result: \`${evidence.stagingVerification.releaseGateResult ?? 'n/a'}\``,
    `- Windows/Firefox high risk: \`${evidence.stagingVerification.windowsFirefoxHighRisk ?? 'n/a'}\``,
    `- Windows bootstrap result: \`${evidence.stagingVerification.windowsBootstrapResult ?? 'n/a'}\``,
    `- Firefox policy result: \`${evidence.stagingVerification.firefoxPolicyResult ?? 'n/a'}\``,
    `- Linux bootstrap result: \`${evidence.stagingVerification.linuxBootstrapResult ?? 'n/a'}\``,
    `- Linux bootstrap run: \`${evidence.stagingVerification.linuxBootstrapRunId ?? 'n/a'}\``,
    `- Linux bootstrap boundary: \`${evidence.stagingVerification.linuxBootstrapFailureBoundaryId ?? 'n/a'}\``,
    `- Windows self-update result: \`${evidence.stagingVerification.windowsSelfUpdateResult ?? 'n/a'}\``,
    `- Linux self-update result: \`${evidence.stagingVerification.linuxSelfUpdateResult ?? 'n/a'}\``,
    `- Preproduction installed-client evidence: \`${evidence.stagingVerification.prepromotionRehearsalResult ?? 'n/a'}\``,
    `- Verified at: \`${evidence.stagingVerification.verifiedAt ?? 'n/a'}\``,
    '',
    '### Canonical Targets',
    '',
    `- Staging: ${evidence.targets.staging.publicUrl ?? 'n/a'}`,
    `- Production: ${evidence.targets.production.publicUrl ?? 'n/a'}`,
    '',
    '### Immutable Images',
    '',
    `- Gateway: \`${evidence.immutableImages.gateway ?? 'n/a'}\``,
    `- Migrations: \`${evidence.immutableImages.migrations ?? 'n/a'}\``,
    `- OpenPath API: \`${evidence.immutableImages.openPathApi ?? 'n/a'}\``,
    `- SPA: \`${evidence.immutableImages.spa ?? 'n/a'}\``,
    `- Release verifier: \`${evidence.immutableImages.verifier ?? 'n/a'}\``,
    '',
    '### Evidence Artifacts',
    '',
    `- Release image metadata: \`${evidence.artifacts.releaseImageMetadata ?? 'n/a'}\``,
    `- Staging release state + verification: \`${evidence.artifacts.stagingReleaseState ?? 'n/a'}\``,
    `- Production smoke results: \`${evidence.artifacts.productionSmokeResults}\``,
    `- Windows production bootstrap canary: \`${evidence.artifacts.windowsProductionBootstrapCanary ?? 'n/a'}\``,
    `- Linux production bootstrap canary: \`${evidence.artifacts.linuxProductionBootstrapCanary ?? 'n/a'}\``,
    `- Release evidence bundle: \`${evidence.artifacts.releaseEvidence ?? 'n/a'}\``,
    '',
    '### Production Health Evidence',
    '',
    `- Production health status: \`${evidence.production?.health?.status ?? 'n/a'}\``,
    `- Production ready: \`${evidence.production?.ready?.ready ?? 'n/a'}\``,
    '',
    '### Trust Model',
    '',
    '- Local pre-commit is a fast format/secrets guard; `verify:incremental`, `verify:commit`, and release gates provide progressively stronger developer-side evidence.',
    '- Staging records smoke + release-gate evidence for the exact promoted SHA and image digests.',
    '- Preproduction installed-client evidence is the functional authority for client bootstrap, browser policy/AJAX, and self-update before production promotion.',
    '- The production client update canary is scheduled/manual post-release monitoring and is not part of the automatic production release path.',
    '- GitHub Actions reuses that staging evidence instead of rerunning the same gate during production promotion.',
    '- Canonical public URLs come from `config/deploy-targets.json`.',
    '',
  ].join('\n');
}
