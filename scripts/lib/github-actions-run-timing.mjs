export function parseGitHubTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid GitHub timestamp: ${String(value)}`);
  }

  return timestamp;
}

function secondsBetween(start, end) {
  if (start === null || end === null) {
    return null;
  }

  return Math.max(0, Math.round((end - start) / 1000));
}

export function summarizeJobTiming(job, options = {}) {
  const createdAtValue = job?.createdAt ?? job?.created_at ?? options.runCreatedAt ?? null;
  const createdAt = parseGitHubTimestamp(createdAtValue);
  const startedAt = parseGitHubTimestamp(job?.startedAt ?? job?.started_at);
  const completedAt = parseGitHubTimestamp(job?.completedAt ?? job?.completed_at);
  const conclusion = job?.conclusion ?? null;
  const skipped = conclusion === 'skipped';

  return {
    id: job?.databaseId ?? job?.id ?? null,
    name: String(job?.name ?? 'unnamed job'),
    status: job?.status ?? null,
    conclusion,
    createdAt: createdAtValue,
    startedAt: job?.startedAt ?? job?.started_at ?? null,
    completedAt: job?.completedAt ?? job?.completed_at ?? null,
    queueSeconds: skipped ? null : secondsBetween(createdAt, startedAt),
    executionSeconds: skipped ? null : secondsBetween(startedAt, completedAt),
    skipped,
  };
}

export function summarizeRunTiming({ run = {}, jobs = [] } = {}) {
  const runCreatedAt = run.createdAt ?? run.created_at ?? null;
  const summarizedJobs = jobs.map((job) => summarizeJobTiming(job, { runCreatedAt }));
  const executedJobs = summarizedJobs.filter((job) => !job.skipped);
  const skippedJobs = summarizedJobs.filter((job) => job.skipped);
  const latestCompletedJob = selectLatestCompletedJob(executedJobs);
  const longestQueueJob = selectLongestJobBy(executedJobs, 'queueSeconds');
  const longestExecutionJob = selectLongestJobBy(executedJobs, 'executionSeconds');

  return {
    run: {
      databaseId: run.databaseId ?? run.id ?? null,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      createdAt: run.createdAt ?? run.created_at ?? null,
      updatedAt: run.updatedAt ?? run.updated_at ?? null,
    },
    jobs: summarizedJobs,
    executedJobs,
    skippedJobs,
    totals: {
      executedJobs: executedJobs.length,
      skippedJobs: skippedJobs.length,
      queueSeconds: executedJobs.reduce((total, job) => total + (job.queueSeconds ?? 0), 0),
      executionSeconds: executedJobs.reduce((total, job) => total + (job.executionSeconds ?? 0), 0),
    },
    criticalPath: {
      terminalJob: latestCompletedJob ? summarizeCriticalJob(latestCompletedJob) : null,
      longestQueueJob: longestQueueJob ? summarizeCriticalJob(longestQueueJob) : null,
      longestExecutionJob: longestExecutionJob ? summarizeCriticalJob(longestExecutionJob) : null,
    },
  };
}

function selectLatestCompletedJob(jobs) {
  return jobs
    .filter((job) => job.completedAt)
    .sort(
      (left, right) =>
        parseGitHubTimestamp(right.completedAt) - parseGitHubTimestamp(left.completedAt)
    )[0];
}

function selectLongestJobBy(jobs, fieldName) {
  return [...jobs].sort((left, right) => (right[fieldName] ?? -1) - (left[fieldName] ?? -1))[0];
}

function summarizeCriticalJob(job) {
  return {
    name: job.name,
    conclusion: job.conclusion,
    queueSeconds: job.queueSeconds,
    executionSeconds: job.executionSeconds,
  };
}

function formatSeconds(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

export function formatRunTimingMarkdown(summary) {
  const lines = [
    '## Run Timing Summary',
    '',
    `Executed jobs: ${summary.totals.executedJobs}. Skipped jobs: ${summary.totals.skippedJobs}. Total queue seconds: ${summary.totals.queueSeconds}. Total execution seconds: ${summary.totals.executionSeconds}.`,
    '',
    ...formatCriticalPathLines(summary.criticalPath),
    '',
    '| Job | Conclusion | Queue seconds | Execution seconds |',
    '| --- | --- | ---: | ---: |',
  ];

  for (const job of summary.jobs) {
    lines.push(
      `| ${job.name} | ${job.conclusion ?? 'n/a'} | ${formatSeconds(
        job.queueSeconds
      )} | ${formatSeconds(job.executionSeconds)} |`
    );
  }

  if (summary.skippedJobs.length > 0) {
    lines.push('');
    lines.push(`Skipped jobs: ${summary.skippedJobs.map((job) => job.name).join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatCriticalPathLines(criticalPath = {}) {
  const lines = ['### Critical Path'];

  if (criticalPath.terminalJob) {
    lines.push(`Terminal job: ${formatJobTimingLabel(criticalPath.terminalJob)}.`);
  }

  if (criticalPath.longestQueueJob) {
    lines.push(`Longest queue wait: ${formatJobTimingLabel(criticalPath.longestQueueJob)}.`);
  }

  if (criticalPath.longestExecutionJob) {
    lines.push(`Longest execution: ${formatJobTimingLabel(criticalPath.longestExecutionJob)}.`);
  }

  if (lines.length === 1) {
    lines.push('No executed jobs.');
  }

  return lines;
}

function formatJobTimingLabel(job) {
  return `${job.name} (queue ${formatSeconds(job.queueSeconds)}s, execution ${formatSeconds(
    job.executionSeconds
  )}s)`;
}
