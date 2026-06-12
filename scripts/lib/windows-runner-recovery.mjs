/**
 * Library: implements Windows runner re-registration and health-check recovery logic via the GitHub Actions API.
 *
 * Invoked by: Imported by `scripts/recover-windows-runner.mjs`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
export const DEFAULT_WINDOWS_RUNNER_RECOVERY = Object.freeze({
  repo: 'balejosg/ClassroomPath',
  runnerName: process.env.CLASSROOMPATH_WINDOWS_RUNNER_NAME ?? '<runner-name>',
  vmid: process.env.WINDOWS_RUNNER_VMID ?? '<vmid>',
  proxmoxHost: 'proxmox-host.example.invalid',
});

export const KNOWN_WINDOWS_RUNNER_WORKFLOWS = Object.freeze([
  'Windows Production Bootstrap Canary',
  'Self-Hosted Windows Runner Smoke',
  'Production Client Update Canary',
  'Windows Firefox Canary',
]);

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting']);
const NON_PRODUCT_BOUNDARIES = new Set(['none', 'canary-not-started', 'runner-health-unavailable']);

function cleanSnapshotLine(line) {
  return line
    .trim()
    .replace(/^[|`+\-\s>]+/, '')
    .trim();
}

function parseSnapshotLine(line) {
  const cleaned = cleanSnapshotLine(line);
  if (!cleaned || /^current\b/i.test(cleaned) || /^name\b/i.test(cleaned)) {
    return null;
  }

  const [name, ...descriptionParts] = cleaned.split(/\s+/);
  if (!name) {
    return null;
  }

  const description = descriptionParts.join(' ');
  const searchable = `${name} ${description}`.toLowerCase();
  const baseline =
    searchable.includes('baseline') &&
    (searchable.includes('clean') ||
      searchable.includes('limpia') ||
      searchable.includes('pre-lab') ||
      searchable.includes('pre-bypass'));

  return {
    name,
    description,
    baseline,
  };
}

export function parseSnapshots(snapshotText) {
  return String(snapshotText ?? '')
    .split(/\r?\n/)
    .map(parseSnapshotLine)
    .filter(Boolean);
}

export function selectBaselineSnapshot(snapshotTextOrList) {
  const snapshots = Array.isArray(snapshotTextOrList)
    ? snapshotTextOrList
    : parseSnapshots(snapshotTextOrList);
  const candidates = snapshots.filter((snapshot) => snapshot.baseline);

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => left.name.localeCompare(right.name)).at(-1) ?? null;
}

function activeWindowsJobs(activeJobs) {
  return (activeJobs ?? []).filter(
    (job) =>
      ACTIVE_STATUSES.has(job.status) &&
      (isKnownWindowsRunnerWorkflow(job.workflow) ||
        String(job.workflow ?? '')
          .toLowerCase()
          .includes('windows') ||
        String(job.jobName ?? job.name ?? '')
          .toLowerCase()
          .includes('windows') ||
        String(job.runnerName ?? job.runner_name ?? '').includes(
          DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName
        ))
  );
}

function hasObsoleteQueuedWindowsJob(activeJobs) {
  return activeWindowsJobs(activeJobs).some(
    (job) => job.status === 'queued' && Number(job.ageMinutes ?? 0) >= 30
  );
}

function extractFailureBoundary(canaryArtifact) {
  if (!canaryArtifact || typeof canaryArtifact !== 'object') {
    return null;
  }

  const direct = canaryArtifact.failureBoundary ?? canaryArtifact.failure_boundary ?? null;
  if (direct?.id) {
    return direct;
  }

  for (const phase of canaryArtifact.diagnosticPhases ?? canaryArtifact.diagnostic_phases ?? []) {
    if (phase?.failureBoundary?.id) {
      return phase.failureBoundary;
    }
    if (phase?.id && phase?.status === 'failed') {
      return { id: phase.id, message: phase.message ?? '' };
    }
  }

  return null;
}

function artifactEndpointReachable(canaryArtifact) {
  if (!canaryArtifact || typeof canaryArtifact !== 'object') {
    return false;
  }

  const endpoint = canaryArtifact.artifactEndpoint ?? canaryArtifact.artifact_endpoint ?? null;
  return endpoint?.reachable === true || endpoint?.status === 'reachable';
}

function dnsEvidenceIsPresent(canaryArtifact) {
  if (!canaryArtifact || typeof canaryArtifact !== 'object') {
    return false;
  }

  const dns = canaryArtifact.dns ?? canaryArtifact.dnsEvidence ?? null;
  return Boolean(
    dns?.before || dns?.after || canaryArtifact.runnerDnsBefore || canaryArtifact.runnerDnsAfter
  );
}

function hasConcreteProductBoundary(canaryArtifact) {
  const boundary = extractFailureBoundary(canaryArtifact);
  if (!boundary?.id || NON_PRODUCT_BOUNDARIES.has(String(boundary.id))) {
    return false;
  }

  return artifactEndpointReachable(canaryArtifact) || dnsEvidenceIsPresent(canaryArtifact);
}

export function recommendWindowsRunnerRecovery({
  runner,
  vm,
  snapshots = [],
  activeJobs = [],
  canaryArtifact = null,
}) {
  const runnerStatus = runner?.status ?? 'missing';
  const vmStatus = vm?.status ?? 'unknown';
  const baselineSnapshot = selectBaselineSnapshot(snapshots);

  if (runnerStatus !== 'online') {
    if (vmStatus === 'running' && baselineSnapshot) {
      return {
        classification: 'snapshot-needed',
        action: `restore baseline snapshot ${baselineSnapshot.name}`,
        snapshot: baselineSnapshot.name,
        reason: `GitHub runner is offline (${runnerStatus}) while VM ${vmStatus}; use the clean baseline before product debugging.`,
      };
    }

    return {
      classification: 'queued/offline',
      action: 'inspect VM console, runner service, and network before touching product code',
      snapshot: baselineSnapshot?.name ?? null,
      reason: `GitHub runner is ${runnerStatus} and VM status is ${vmStatus}.`,
    };
  }

  if (hasConcreteProductBoundary(canaryArtifact)) {
    const boundary = extractFailureBoundary(canaryArtifact);
    return {
      classification: 'product-failure',
      action: 'debug the canary/product boundary instead of recovering the runner',
      snapshot: null,
      reason: `Runner is healthy and canary artifact reports concrete boundary ${boundary.id}.`,
    };
  }

  if (runner?.busy || hasObsoleteQueuedWindowsJob(activeJobs)) {
    return {
      classification: 'online-but-stuck',
      action: 'review or cancel obsolete queued Windows runs without cancelling the target run',
      snapshot: null,
      reason: 'Runner is online but active Windows queue state can block fresh diagnostics.',
    };
  }

  return {
    classification: 'healthy',
    action: 'run runner smoke before escalating to product canary analysis',
    snapshot: null,
    reason: 'Runner is online with no blocking Windows queue evidence.',
  };
}

export function isKnownWindowsRunnerWorkflow(workflowName) {
  return KNOWN_WINDOWS_RUNNER_WORKFLOWS.includes(String(workflowName ?? ''));
}
