import { summarizeJobTiming } from './github-actions-run-timing.mjs';

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

function formatTimingSummary(job) {
  if (!job) {
    return '';
  }

  const timing = summarizeJobTiming(job);
  const parts = [];

  if (timing.queueSeconds !== null) {
    parts.push(`Queue: ${timing.queueSeconds}s.`);
  }

  if (timing.executionSeconds !== null) {
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
} = {}) {
  const normalizedWorkflow = String(workflow).trim();
  const activeJob = firstActiveJob(latestRunJobs);
  const normalizedStep = String(currentStep || firstActiveStepName(activeJob)).trim();
  const resolvedActiveJobName = String(activeJobName || (activeJob?.name ?? '')).trim();

  if (normalizedStep.includes('Wait for OpenPath prerelease APT')) {
    return {
      kind: 'openpath-prerelease-apt',
      currentStep: normalizedStep,
      workflow: normalizedWorkflow,
      runUrl,
      upstreamSha,
      latestRunStatus,
      activeJobName: resolvedActiveJobName,
      timingSummary: formatTimingSummary(activeJob),
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
      timingSummary: formatTimingSummary(activeJob),
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
    timingSummary: formatTimingSummary(activeJob),
  };
}

export function formatReleaseWaitBlocker(blocker = {}) {
  const parts = [];

  if (blocker.kind === 'openpath-prerelease-apt') {
    parts.push(`Waiting on OpenPath prerelease APT for ${blocker.upstreamSha || 'unknown SHA'}.`);
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
