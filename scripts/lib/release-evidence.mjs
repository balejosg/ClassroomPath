// @ts-check

import { createReleaseEvidenceSnapshot } from './release-evidence-snapshot.mjs';

export {
  STAGING_DEPLOYMENT_MODES,
  buildPromotionEligibilityOutputs,
  buildReleaseEvidenceSnapshot,
  buildStagingReleaseEvidenceOutputs,
  createReleaseEvidenceSnapshot,
  deriveStagingDeploymentMode,
  evaluatePromotionEligibility,
  isStagingDeploymentMode,
  normalizeReleaseEvidenceSnapshot,
  projectReleaseEvidenceSnapshotToWorkflowOutputs,
  serializeReleaseEvidenceSnapshot,
  validateCurrentReleaseState,
  validateHighRiskStagingVerification,
  validateReleaseEvidenceSnapshot,
  validateSignedFirefoxReleaseStagingVerification,
  validateStagingVerification,
} from './release-evidence-snapshot.mjs';

export function buildReleaseEvidence(env = process.env) {
  return createReleaseEvidenceSnapshot(env);
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
      label: 'Staging enrollment downloads',
      result: evidence.stagingVerification.enrollmentDownloadResult ?? 'n/a',
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

export function renderReleaseEvidenceMarkdown(evidenceInput) {
  const evidence = createReleaseEvidenceSnapshot(evidenceInput);
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
