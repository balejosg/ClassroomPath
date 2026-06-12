/**
 * Classifies GitHub Actions workflow run health (queued, stale, in-progress, terminal) for use by health-check scripts.
 *
 * Invoked by: Imported by `scripts/actions-health.mjs`; tested by `github-actions-health.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN.
 */
export function classifyWorkflowRunHealth(run = {}) {
  const nowMs = run.nowMs ?? Date.now();
  const staleAfterMs = run.staleAfterMs ?? 30 * 60 * 1000;
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  const queuedWithStart = jobs.filter((job) => job.status === 'queued' && hasValue(job.startedAt));
  const activeTooLong = jobs.filter((job) => {
    if (job.status !== 'in_progress' || !hasValue(job.startedAt)) {
      return false;
    }

    const startedAtMs = Date.parse(job.startedAt);
    return Number.isFinite(startedAtMs) && nowMs - startedAtMs > staleAfterMs;
  });

  if (queuedWithStart.length > 0) {
    return {
      state: 'corrupt',
      recommendedAction: 'rerun-workflow',
      reason: `queued jobs have startedAt: ${joinJobNames(queuedWithStart)}`,
      jobs: queuedWithStart.map((job) => job.name),
      cancelable: false,
    };
  }

  if (activeTooLong.length > 0) {
    return {
      state: 'stale',
      recommendedAction: 'inspect-runner-logs',
      reason: `in-progress jobs exceeded stale threshold: ${joinJobNames(activeTooLong)}`,
      jobs: activeTooLong.map((job) => job.name),
      cancelable: true,
    };
  }

  if (run.status === 'completed' && run.conclusion === 'failure') {
    return {
      state: 'failed',
      recommendedAction: 'inspect-failed-logs',
      reason: 'workflow completed with failure',
      jobs: [],
      cancelable: false,
    };
  }

  if (run.status === 'completed' && run.conclusion === 'success') {
    return {
      state: 'healthy',
      recommendedAction: 'none',
      reason: 'workflow completed successfully',
      jobs: [],
      cancelable: false,
    };
  }

  if (run.status === 'queued') {
    return {
      state: 'queued',
      recommendedAction: 'wait',
      reason: 'workflow status is queued',
      jobs: [],
      cancelable: true,
    };
  }

  return {
    state: 'running',
    recommendedAction: 'wait',
    reason: `workflow status is ${hasValue(run.status) ? run.status : 'unknown'}`,
    jobs: [],
    cancelable: run.status === 'in_progress',
  };
}

function joinJobNames(jobs) {
  return jobs
    .map((job) => job.name)
    .filter(hasValue)
    .join(', ');
}

function hasValue(input) {
  return String(input ?? '').trim().length > 0;
}
