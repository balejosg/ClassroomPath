// @ts-check

const FAILURE_RESULTS = new Set(['failure', 'failed', 'cancelled', 'timed_out', 'action_required']);
const SUCCESS_RESULTS = new Set(['success', 'live-tested', 'ok', 'published']);
const PARTIAL_RESULTS = new Set([
  'pending-post-release',
  'pending',
  'skipped',
  'advisory-only',
  'not_run',
]);
const NOT_APPLICABLE_RESULTS = new Set(['not_applicable', 'n/a']);
const BAD_ARTIFACT_STATUSES = new Set(['missing', 'invalid', 'failed_to_download']);

function valueOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeResult(value) {
  return valueOrNull(value) ?? 'unknown';
}

function markdownCell(value) {
  return String(value ?? 'n/a')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function durationLabelFromSeconds(seconds) {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds) || numericSeconds < 0) {
    return 'n/a';
  }

  const rounded = Math.round(numericSeconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return minutes > 0
    ? `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`
    : `${remainingSeconds}s`;
}

function jobName(job) {
  return valueOrNull(job?.name) ?? 'n/a';
}

function durationSecondsFromJob(job, metric) {
  const seconds = Number(job?.[metric]);
  return Number.isFinite(seconds) && seconds >= 0 ? durationLabelFromSeconds(seconds) : null;
}

function jobNameWithDuration(job, metric) {
  const name = jobName(job);
  const duration = durationSecondsFromJob(job, metric);

  return duration ? `${name} (${duration})` : name;
}

function buildTiming(timings) {
  const criticalPath = timings?.criticalPath ?? {};
  const criticalPathJobs = Array.isArray(criticalPath.jobs) ? criticalPath.jobs : [];

  return {
    stagingToProductionDuration: durationLabelFromSeconds(timings?.totalWallSeconds),
    topQueueBlocker: jobNameWithDuration(criticalPath.longestQueueJob, 'queueSeconds'),
    topExecutionBlocker: jobNameWithDuration(criticalPath.longestExecutionJob, 'executionSeconds'),
    criticalPath:
      criticalPathJobs.length > 0
        ? criticalPathJobs.map((job) => jobName(job)).join(' -> ')
        : 'n/a',
  };
}

function normalizeSourceArtifacts(sourceArtifacts) {
  return (Array.isArray(sourceArtifacts) ? sourceArtifacts : [])
    .map((artifact) => {
      if (typeof artifact === 'string') {
        return { path: artifact, status: 'read' };
      }
      return {
        path: valueOrNull(artifact?.path) ?? 'unknown',
        status: valueOrNull(artifact?.status) ?? 'unknown',
      };
    })
    .filter((artifact) => artifact.path);
}

function buildGate({ id, label, result, boundary = 'none', evidence = 'n/a', category }) {
  return {
    id,
    label,
    result: normalizeResult(result),
    boundary: valueOrNull(boundary) ?? 'none',
    evidence: valueOrNull(evidence) ?? 'n/a',
    category,
  };
}

function buildArtifactIntegrityGates(releaseEvidence) {
  return Object.entries(releaseEvidence?.artifactIntegrity ?? {}).map(([artifactName, integrity]) =>
    buildGate({
      id: `artifact-integrity-${artifactName}`,
      label: `Artifact integrity: ${artifactName}`,
      result: integrity?.status ?? 'unknown',
      boundary: BAD_ARTIFACT_STATUSES.has(String(integrity?.status ?? ''))
        ? 'artifact-integrity'
        : 'none',
      evidence: integrity?.message ?? artifactName,
      category: 'artifact-integrity',
    })
  );
}

function buildGates(releaseEvidence) {
  if (!releaseEvidence) {
    return [
      buildGate({
        id: 'release-evidence',
        label: 'Release evidence artifact',
        result: 'unknown',
        boundary: 'unknown',
        evidence: 'missing or unreadable',
        category: 'required',
      }),
    ];
  }

  return [
    buildGate({
      id: 'verify-openpath-upstream',
      label: 'Verify OpenPath upstream',
      result: releaseEvidence.jobs?.verifyOpenPathUpstream,
      evidence: releaseEvidence.release?.openPathSha,
      category: 'required',
    }),
    buildGate({
      id: 'resolve-release-images',
      label: 'Resolve release images',
      result: releaseEvidence.jobs?.resolveReleaseImages,
      evidence: releaseEvidence.artifacts?.releaseImageMetadata,
      category: 'required',
    }),
    buildGate({
      id: 'verify-staging-release-state',
      label: 'Verify staging release state',
      result: releaseEvidence.jobs?.verifyStagingReleaseState,
      evidence: releaseEvidence.artifacts?.stagingReleaseState,
      category: 'required',
    }),
    buildGate({
      id: 'preproduction-installed-client-evidence',
      label: 'Preproduction installed-client evidence',
      result:
        releaseEvidence.stagingVerification?.windowsFirefoxHighRisk === 'true'
          ? releaseEvidence.stagingVerification?.prepromotionRehearsalResult
          : 'not_applicable',
      boundary:
        releaseEvidence.stagingVerification?.prepromotionRehearsalResult &&
        releaseEvidence.stagingVerification.prepromotionRehearsalResult !== 'success'
          ? 'preproduction-installed-client-evidence'
          : 'none',
      evidence: releaseEvidence.artifacts?.stagingReleaseState,
      category: 'required',
    }),
    buildGate({
      id: 'windows-firefox-canary',
      label: 'Windows/Firefox canary',
      result: releaseEvidence.jobs?.windowsFirefoxCanary,
      evidence: 'advisory pre-deploy signal',
      category: 'advisory',
    }),
    buildGate({
      id: 'deploy-production',
      label: 'Deploy production',
      result: releaseEvidence.jobs?.deployProduction,
      evidence: releaseEvidence.workflowRunUrl,
      category: 'required',
    }),
    buildGate({
      id: 'smoke-test-production',
      label: 'Production smoke',
      result: releaseEvidence.jobs?.smokeTestProduction,
      evidence: releaseEvidence.artifacts?.productionSmokeResults,
      category: 'required',
    }),
    buildGate({
      id: 'windows-production-bootstrap-canary',
      label: 'Windows production bootstrap canary monitor',
      result: releaseEvidence.jobs?.windowsProductionBootstrapCanary,
      boundary:
        releaseEvidence.canaries?.windows?.failureBoundary?.id ??
        releaseEvidence.diagnostics?.windowsProductionBootstrapFailureBoundary?.id,
      evidence: releaseEvidence.artifacts?.windowsProductionBootstrapCanary,
      category: 'post-release-advisory',
    }),
    buildGate({
      id: 'linux-production-bootstrap-canary',
      label: 'Linux production bootstrap canary monitor',
      result: releaseEvidence.jobs?.linuxProductionBootstrapCanary,
      boundary:
        releaseEvidence.canaries?.linux?.failureBoundary?.id ??
        releaseEvidence.diagnostics?.linuxProductionBootstrapFailureBoundary?.id,
      evidence: releaseEvidence.artifacts?.linuxProductionBootstrapCanary,
      category: 'post-release-advisory',
    }),
    buildGate({
      id: 'production-client-update-canary',
      label: 'Production client update canary',
      result: releaseEvidence.jobs?.productionClientUpdateCanary,
      evidence: 'post-release advisory signal',
      category: 'post-release-advisory',
    }),
    buildGate({
      id: 'release-evidence',
      label: 'Release evidence artifact',
      result: releaseEvidence.artifacts?.releaseEvidence ? 'published' : 'unknown',
      evidence: releaseEvidence.artifacts?.releaseEvidence,
      category: 'required',
    }),
    ...buildArtifactIntegrityGates(releaseEvidence),
  ];
}

function isFailingBlockingGate(gate) {
  if (gate.category === 'advisory' || gate.category === 'post-release-advisory') {
    return false;
  }

  return FAILURE_RESULTS.has(gate.result) || BAD_ARTIFACT_STATUSES.has(gate.result);
}

function isUnknownBlockingGate(gate) {
  if (gate.category === 'advisory' || gate.category === 'post-release-advisory') {
    return false;
  }

  return gate.result === 'unknown';
}

function isPartialGate(gate) {
  if (gate.category !== 'post-release-required' && gate.category !== 'post-release-advisory') {
    return false;
  }

  return PARTIAL_RESULTS.has(gate.result);
}

function classifyStatus({ releaseEvidence, gates }) {
  if (!releaseEvidence) {
    return 'unknown';
  }

  if (gates.some((gate) => gate.category === 'artifact-integrity' && isFailingBlockingGate(gate))) {
    return 'fail';
  }

  if (gates.some(isFailingBlockingGate)) {
    return 'fail';
  }

  if (gates.some(isUnknownBlockingGate)) {
    return 'unknown';
  }

  if (gates.some(isPartialGate)) {
    return 'partial';
  }

  return 'pass';
}

function hasExplicitFailureBoundary(gate) {
  return (
    FAILURE_RESULTS.has(gate.result) &&
    valueOrNull(gate.boundary) &&
    gate.boundary !== 'none' &&
    gate.boundary !== 'unknown'
  );
}

function failedJobBoundary(gates, runMetadata) {
  const failedGate = gates.find(
    (gate) => isFailingBlockingGate(gate) && gate.category !== 'artifact-integrity'
  );
  if (!failedGate) {
    return null;
  }

  const failedJob = (runMetadata?.jobs ?? []).find((job) =>
    FAILURE_RESULTS.has(normalizeResult(job?.conclusion ?? job?.status))
  );

  return {
    id: failedGate.id,
    message: failedJob
      ? `Failed GitHub job: ${jobName(failedJob)}`
      : `Blocking gate failed: ${failedGate.label}`,
    recommendedNextAction:
      'Inspect the failing gate evidence, clean up side effects, then rerun failed jobs.',
    safeToRetry: 'after-cleanup',
  };
}

function deriveFailureBoundary({ status, releaseEvidence, gates, runMetadata, sourceArtifacts }) {
  if (status === 'pass' || status === 'partial') {
    return {
      id: 'none',
      message: status === 'partial' ? 'Post-release canary evidence is not complete yet.' : 'none',
      recommendedNextAction:
        status === 'partial'
          ? 'Wait for post-release canaries, then regenerate deploy brief.'
          : 'No action required',
      safeToRetry: status === 'partial' ? 'unknown' : 'no',
    };
  }

  const explicitBoundaryGate = gates.find(hasExplicitFailureBoundary);
  if (explicitBoundaryGate) {
    const message =
      explicitBoundaryGate.id === 'preproduction-installed-client-evidence'
        ? 'Preproduction installed-client evidence failed before production promotion.'
        : explicitBoundaryGate.id === 'windows-production-bootstrap-canary'
          ? (releaseEvidence?.canaries?.windows?.failureBoundary?.message ??
            releaseEvidence?.diagnostics?.windowsProductionBootstrapFailureBoundary?.message)
          : (releaseEvidence?.canaries?.linux?.failureBoundary?.message ??
            releaseEvidence?.diagnostics?.linuxProductionBootstrapFailureBoundary?.message);

    return {
      id: explicitBoundaryGate.boundary,
      message: valueOrNull(message) ?? `Blocking gate failed: ${explicitBoundaryGate.label}`,
      recommendedNextAction:
        explicitBoundaryGate.id === 'preproduction-installed-client-evidence'
          ? 'Inspect the failed preproduction gate, refresh staging evidence for the same SHA, then retry promotion readiness.'
          : 'Inspect the canary artifact and clean up target state before retrying.',
      safeToRetry: 'after-cleanup',
    };
  }

  const artifactGate = gates.find(
    (gate) => gate.category === 'artifact-integrity' && isFailingBlockingGate(gate)
  );
  if (artifactGate) {
    return {
      id: 'artifact-integrity',
      message: `${artifactGate.label} is ${artifactGate.result}.`,
      recommendedNextAction:
        'Regenerate the release evidence bundle after artifacts are available.',
      safeToRetry: 'after-cleanup',
    };
  }

  const jobBoundary = failedJobBoundary(gates, runMetadata);
  if (jobBoundary) {
    return jobBoundary;
  }

  return {
    id: 'unknown',
    message:
      sourceArtifacts.length > 0
        ? `Required evidence is missing or unreadable: ${sourceArtifacts
            .map((artifact) => `${artifact.path} (${artifact.status})`)
            .join(', ')}.`
        : 'Required release evidence is missing or unreadable.',
    recommendedNextAction: 'Inspect release evidence artifacts before retrying.',
    safeToRetry: 'unknown',
  };
}

function deriveNextCommand({ status, releaseEvidence, failureBoundary, repo }) {
  if (status === 'pass') {
    return 'No action required';
  }

  if (status === 'partial') {
    return 'Wait for post-release canaries, then rerun npm run ops:deploy-brief.';
  }

  if (failureBoundary.id === 'artifact-integrity') {
    const runId = valueOrNull(releaseEvidence?.workflowRunId);
    const tag = valueOrNull(releaseEvidence?.release?.tagName);
    return runId && tag
      ? `npm run release:evidence-bundle -- --deploy-run ${runId} --tag ${tag} --windows-canary-run ${runId} --linux-canary-run ${runId} --output-dir release-evidence-bundle`
      : 'Regenerate release evidence bundle after artifacts are available.';
  }

  const runId = resolveWorkflowRunId(releaseEvidence);
  if (status === 'fail' && runId) {
    return `gh run rerun ${runId} --failed --repo ${repo}`;
  }

  return 'Inspect release evidence artifacts before retrying.';
}

function resolveWorkflowRunId(releaseEvidence) {
  const explicitRunId = valueOrNull(releaseEvidence?.workflowRunId);
  if (explicitRunId) {
    return explicitRunId;
  }

  const workflowRunUrl = valueOrNull(releaseEvidence?.workflowRunUrl);
  return workflowRunUrl?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
}

export function buildDeployBrief({
  releaseEvidence,
  runMetadata = null,
  sourceArtifacts = [],
  repo = 'balejosg/ClassroomPath',
} = {}) {
  const normalizedSourceArtifacts = normalizeSourceArtifacts(sourceArtifacts);
  const gates = buildGates(releaseEvidence);
  const status = classifyStatus({ releaseEvidence, gates });
  const failureBoundary = deriveFailureBoundary({
    status,
    releaseEvidence,
    gates,
    runMetadata,
    sourceArtifacts: normalizedSourceArtifacts,
  });

  return {
    generatedAt: new Date().toISOString(),
    status,
    tag: valueOrNull(releaseEvidence?.release?.tagName) ?? 'unknown',
    classroomPathSha: valueOrNull(releaseEvidence?.release?.classroomPathSha) ?? 'unknown',
    openPathSha: valueOrNull(releaseEvidence?.release?.openPathSha) ?? 'unknown',
    workflowRunUrl: valueOrNull(releaseEvidence?.workflowRunUrl) ?? valueOrNull(runMetadata?.url),
    promotionEligibility: valueOrNull(releaseEvidence?.promotionEligibility?.status) ?? 'unknown',
    gates,
    failureBoundary,
    timing: buildTiming(releaseEvidence?.timings),
    nextCommand: deriveNextCommand({ status, releaseEvidence, failureBoundary, repo }),
    sourceArtifacts: normalizedSourceArtifacts,
  };
}

export function renderDeployBriefMarkdown(brief) {
  return [
    '# Deploy Brief',
    '',
    `Status: ${brief.status}`,
    `Tag: ${brief.tag}`,
    `ClassroomPath SHA: ${brief.classroomPathSha}`,
    `OpenPath SHA: ${brief.openPathSha}`,
    `Run: ${brief.workflowRunUrl ?? 'unknown'}`,
    `Promotion eligibility: ${brief.promotionEligibility}`,
    '',
    '## Gate Table',
    '| Gate | Result | Boundary | Evidence |',
    '| --- | --- | --- | --- |',
    ...brief.gates.map(
      (gate) =>
        `| ${markdownCell(gate.label)} | ${markdownCell(gate.result)} | ${markdownCell(
          gate.boundary
        )} | ${markdownCell(gate.evidence)} |`
    ),
    '',
    '## Failure Boundary',
    `- Boundary: ${brief.failureBoundary.id}`,
    `- Message: ${brief.failureBoundary.message}`,
    `- Recommended next action: ${brief.failureBoundary.recommendedNextAction}`,
    `- Safe to retry: ${brief.failureBoundary.safeToRetry}`,
    '',
    '## Bottleneck Summary',
    `- Staging-to-production duration: ${brief.timing.stagingToProductionDuration}`,
    `- Top queue blocker: ${brief.timing.topQueueBlocker}`,
    `- Top execution blocker: ${brief.timing.topExecutionBlocker}`,
    `- Critical path: ${brief.timing.criticalPath}`,
    '',
    '## Next Command',
    brief.nextCommand,
    '',
  ].join('\n');
}
