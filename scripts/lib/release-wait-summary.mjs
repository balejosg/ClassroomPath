import { summarizeJobTiming } from './github-actions-run-timing.mjs';

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function elapsedSecondsSince(value, nowMs) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null || !Number.isFinite(nowMs)) {
    return null;
  }

  return Math.max(0, Math.round((nowMs - timestamp) / 1000));
}

function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return '';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function firstActiveStepName(job = {}) {
  if (!job) {
    return '';
  }

  for (const step of job.steps ?? []) {
    if (step?.status === 'in_progress') {
      return String(step.name ?? '').trim();
    }
  }

  return '';
}

function firstActiveJob(jobs = []) {
  return jobs.find((job) => job?.status === 'in_progress') ?? null;
}

function formatTimingSummary(job, { nowMs = Date.now(), waitStartedAtMs = null } = {}) {
  if (!job) {
    return '';
  }

  const timing = summarizeJobTiming(job);
  const parts = [];
  const waitElapsed = Number.isFinite(waitStartedAtMs)
    ? Math.max(0, Math.round((nowMs - waitStartedAtMs) / 1000))
    : null;

  if (waitElapsed !== null) {
    parts.push(`Wait elapsed: ${formatDurationSeconds(waitElapsed)}.`);
  }

  if (timing.queueSeconds !== null) {
    parts.push(`Queue: ${timing.queueSeconds}s.`);
  }

  const activeExecutionSeconds =
    job?.status === 'in_progress'
      ? elapsedSecondsSince(job?.startedAt ?? job?.started_at, nowMs)
      : null;

  if (activeExecutionSeconds !== null) {
    parts.push(`Execution so far: ${formatDurationSeconds(activeExecutionSeconds)}.`);
  } else if (timing.executionSeconds !== null) {
    parts.push(`Execution: ${timing.executionSeconds}s.`);
  }

  return parts.join(' ');
}

export function classifyReleaseWaitBlocker({
  currentStep = '',
  workflow = '',
  runUrl = '',
  upstreamSha = '',
  latestRunStatus = '',
  activeJobName = '',
  latestRunJobs = [],
  waitStartedAtMs = null,
  nowMs = Date.now(),
} = {}) {
  const normalizedWorkflow = String(workflow).trim();
  const activeJob = firstActiveJob(latestRunJobs);
  const normalizedStep = String(currentStep || firstActiveStepName(activeJob)).trim();
  const resolvedActiveJobName = String(activeJobName || (activeJob?.name ?? '')).trim();
  const timingSummary = formatTimingSummary(activeJob, { nowMs, waitStartedAtMs });

  if (normalizedStep.includes('Wait for OpenPath prerelease APT')) {
    return {
      kind: 'openpath-prerelease-apt',
      currentStep: normalizedStep,
      workflow: normalizedWorkflow,
      runUrl,
      upstreamSha,
      latestRunStatus,
      activeJobName: resolvedActiveJobName,
      timingSummary,
    };
  }

  if (normalizedWorkflow.toLowerCase().includes('release-candidate')) {
    return {
      kind: 'classroompath-release-candidate',
      currentStep: normalizedStep,
      workflow: normalizedWorkflow,
      runUrl,
      upstreamSha,
      latestRunStatus,
      activeJobName: resolvedActiveJobName,
      timingSummary,
    };
  }

  return {
    kind: 'unknown-release-wait',
    currentStep: normalizedStep,
    workflow: normalizedWorkflow,
    runUrl,
    upstreamSha,
    latestRunStatus,
    activeJobName: resolvedActiveJobName,
    timingSummary,
  };
}

export function formatReleaseWaitBlocker(blocker = {}) {
  const parts = [];

  if (blocker.kind === 'openpath-prerelease-apt') {
    parts.push(`Waiting on OpenPath prerelease APT for ${blocker.upstreamSha || 'unknown SHA'}.`);
    if (blocker.workflow) {
      parts.push(`Workflow: ${blocker.workflow}.`);
    }
    if (blocker.currentStep) {
      parts.push(`Step: ${blocker.currentStep}.`);
    }
    if (blocker.activeJobName) {
      parts.push(`Job: ${blocker.activeJobName}.`);
    }
    if (blocker.timingSummary) {
      parts.push(blocker.timingSummary);
    }
    if (blocker.runUrl) {
      parts.push(`Run: ${blocker.runUrl}`);
    }
    if (blocker.latestRunStatus) {
      parts.push(`Status: ${blocker.latestRunStatus}.`);
    }
    parts.push('Next: wait unless run fails; do not retry staging yet.');
    return parts.join(' ');
  }

  if (blocker.kind === 'classroompath-release-candidate') {
    parts.push('Waiting on ClassroomPath release-candidate manifest.');
    if (blocker.workflow) {
      parts.push(`Workflow: ${blocker.workflow}.`);
    }
    if (blocker.currentStep) {
      parts.push(`Step: ${blocker.currentStep}.`);
    }
    if (blocker.activeJobName) {
      parts.push(`Job: ${blocker.activeJobName}.`);
    }
    if (blocker.timingSummary) {
      parts.push(blocker.timingSummary);
    }
    if (blocker.runUrl) {
      parts.push(`Run: ${blocker.runUrl}`);
    }
    if (blocker.latestRunStatus) {
      parts.push(`Status: ${blocker.latestRunStatus}.`);
    }
    parts.push('Next: wait unless RC workflow fails.');
    return parts.join(' ');
  }

  parts.push('Waiting on release prerequisite.');
  if (blocker.workflow) {
    parts.push(`Workflow: ${blocker.workflow}.`);
  }
  if (blocker.currentStep) {
    parts.push(`Step: ${blocker.currentStep}.`);
  }
  if (blocker.activeJobName) {
    parts.push(`Job: ${blocker.activeJobName}.`);
  }
  if (blocker.timingSummary) {
    parts.push(blocker.timingSummary);
  }
  if (blocker.runUrl) {
    parts.push(`Run: ${blocker.runUrl}`);
  }
  if (blocker.latestRunStatus) {
    parts.push(`Status: ${blocker.latestRunStatus}.`);
  }
  return parts.join(' ');
}
