/**
 * Guards against concurrent destructive Windows runner jobs by querying active workflow runs and blocking if conflicts are found.
 *
 * Invoked by: Imported by `assert-destructive-runner-available.mjs`; tested by `destructive-runner-guard.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
export const DEFAULT_DESTRUCTIVE_WINDOWS_JOB_NAMES = Object.freeze([
  'Windows Client Self-Update Canary',
  'Windows Firefox Canary',
  'Windows Production Bootstrap Canary',
]);

const ACTIVE_RUN_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting']);
const ACTIVE_JOB_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting']);

function normalizeId(value) {
  return value === undefined || value === null ? '' : String(value);
}

function jobUsesRequiredLabels(job, requiredLabels) {
  if (!requiredLabels.length) {
    return true;
  }

  if (!Array.isArray(job.labels) || job.labels.length === 0) {
    return true;
  }

  return requiredLabels.every((label) => job.labels.includes(label));
}

export function findBlockingDestructiveRunnerJobs({
  runs,
  jobsByRunId,
  currentRunId,
  destructiveJobNames = DEFAULT_DESTRUCTIVE_WINDOWS_JOB_NAMES,
  requiredLabels = ['self-hosted', 'Windows', 'classroompath'],
}) {
  const currentRunIdText = normalizeId(currentRunId);
  const destructiveNames = new Set(destructiveJobNames);

  return runs.flatMap((run) => {
    if (normalizeId(run.id) === currentRunIdText || !ACTIVE_RUN_STATUSES.includes(run.status)) {
      return [];
    }

    const jobs = jobsByRunId.get?.(normalizeId(run.id)) ?? jobsByRunId[normalizeId(run.id)] ?? [];

    return jobs
      .filter((job) => destructiveNames.has(job.name))
      .filter((job) => ACTIVE_JOB_STATUSES.includes(job.status))
      .filter((job) => job.conclusion === null || job.conclusion === undefined)
      .filter((job) => jobUsesRequiredLabels(job, requiredLabels))
      .map((job) => ({
        runId: normalizeId(run.id),
        runNumber: run.run_number ?? null,
        workflowName: run.name ?? run.workflow_name ?? '',
        htmlUrl: run.html_url ?? job.html_url ?? '',
        jobName: job.name,
        jobStatus: job.status,
        runnerName: job.runner_name ?? '',
        labels: Array.isArray(job.labels) ? job.labels : [],
      }));
  });
}

export function formatBlockingDestructiveRunnerMessage(blockingJobs) {
  const lines = [
    'Another destructive Windows runner job is active for the ClassroomPath runner.',
    'Failing before mutating DNS, browser policy, services, scheduled tasks, or OpenPath client state.',
  ];

  for (const job of blockingJobs) {
    lines.push(
      `- ${job.workflowName} / ${job.jobName} run ${job.runNumber ?? job.runId} (${job.jobStatus}) ${job.htmlUrl}`
    );
  }

  return lines.join('\n');
}
