import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { summarizeRunTiming } from './github-actions-run-timing.mjs';

export function quoteArg(arg) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

export function renderCommand(args) {
  return args.map((arg) => quoteArg(String(arg))).join(' ');
}

export function runGithubCommand(
  args,
  { capture = false, allowFailure = false, dryRun = false, emit = console.log, shouldFail } = {}
) {
  if (dryRun) {
    const command = renderCommand(args);
    emit(command);
    if (shouldFail?.(args)) {
      if (allowFailure) {
        return { status: 1, stdout: '', stderr: `${command} failed with exit code 1\n` };
      }
      throw new Error(`${command} failed with exit code 1`);
    }
    return capture ? '<latest-run-id>' : '';
  }

  const result = spawnSync(args[0], args.slice(1), {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture || allowFailure ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${renderCommand(args)} failed with exit code ${result.status ?? 'unknown'}`);
  }

  if (allowFailure) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  return capture ? result.stdout.trim() : '';
}

export function writeEvidenceFile(path, contents, { dryRun = false, emit = console.log } = {}) {
  if (dryRun) {
    emit(`write ${path}`);
    if (path.endsWith('diagnostic-summary.json')) {
      emit(contents);
    }
    return;
  }
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function captureCommandToFile(args, filePath, options) {
  const result = runGithubCommand(args, { ...options, allowFailure: true });
  const contents =
    typeof result === 'object'
      ? `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`
      : '';
  writeEvidenceFile(filePath, contents, options);
  return {
    status: typeof result === 'object' ? result.status : 0,
    contents,
  };
}

function readJsonFile(path, fallback, { dryRun = false } = {}) {
  if (dryRun) return fallback;
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function getPrimaryJobIds(jobsJson, { dryRun = false } = {}) {
  if (dryRun) return ['<job-id>'];
  return (jobsJson?.jobs ?? [])
    .map((job) => job?.databaseId ?? job?.id)
    .filter((id) => id !== undefined && id !== null)
    .map(String);
}

function buildDryRunJobsFallback() {
  return {
    jobs: [
      {
        databaseId: '<job-id>',
        name: 'Windows Student Policy',
        conclusion: 'success',
        createdAt: '2026-04-29T10:00:00Z',
        startedAt: '2026-04-29T10:02:30Z',
        completedAt: '2026-04-29T10:11:19Z',
        runner_name: '<runner-name>',
        runner_group_name: 'Default',
        labels: ['self-hosted', 'Windows', 'X64', 'proxmox', 'classroompath'],
      },
      {
        databaseId: '<skipped-job-id>',
        name: 'Hosted Windows Advisory',
        conclusion: 'skipped',
        createdAt: '2026-04-29T10:00:00Z',
        startedAt: null,
        completedAt: '2026-04-29T10:00:01Z',
      },
    ],
  };
}

function collectRunnerMetadata(jobs = []) {
  const runnerJob = jobs.find((job) => job?.runner_name || job?.runnerName);
  return {
    runner_name: runnerJob?.runner_name ?? runnerJob?.runnerName ?? null,
    runner_group_name: runnerJob?.runner_group_name ?? runnerJob?.runnerGroupName ?? null,
    labels: Array.isArray(runnerJob?.labels) ? runnerJob.labels : [],
  };
}

export function dispatchWorkflow({ repo, workflow, ref, fields = {}, dryRun = false, emit }) {
  const args = ['gh', 'workflow', 'run', workflow, '--repo', repo, '--ref', ref];
  for (const [key, value] of Object.entries(fields)) {
    args.push('-f', `${key}=${value}`);
  }
  return runGithubCommand(args, { dryRun, emit });
}

export function findLatestRun({ repo, workflow, ref, dryRun = false, emit }) {
  return runGithubCommand(
    [
      'gh',
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      workflow,
      '--branch',
      ref,
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId',
    ],
    { capture: true, dryRun, emit }
  );
}

export function waitForRun({ repo, runId, dryRun = false, fakeWatchFailure = false, emit }) {
  return runGithubCommand(['gh', 'run', 'watch', runId, '--repo', repo, '--exit-status'], {
    allowFailure: true,
    dryRun,
    emit,
    shouldFail: (args) =>
      fakeWatchFailure && args[0] === 'gh' && args[1] === 'run' && args[2] === 'watch',
  });
}

export function downloadArtifacts({
  repo,
  runId,
  evidenceDir,
  dryRun = false,
  fakeArtifactDownloadFailure = false,
  attempts = 3,
  retryDelayMs = 10_000,
  emit,
  error = console.error,
}) {
  let result = { status: 1, stdout: '', stderr: '' };
  const maxAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = runGithubCommand(
      ['gh', 'run', 'download', runId, '--repo', repo, '--dir', evidenceDir],
      {
        allowFailure: true,
        dryRun,
        emit,
        shouldFail: (args) =>
          fakeArtifactDownloadFailure &&
          args[0] === 'gh' &&
          args[1] === 'run' &&
          args[2] === 'download',
      }
    );

    const status = typeof result === 'object' ? result.status : 0;
    if (status === 0) {
      return { status };
    }

    if (!dryRun && attempt < maxAttempts) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
    }
  }

  const status = typeof result === 'object' ? result.status : 0;
  if (typeof result === 'object') {
    const errorPath = resolve(evidenceDir, 'artifact-download-error.txt');
    writeEvidenceFile(errorPath, `${result.stdout}${result.stderr}`, { dryRun, emit });
    error(`Artifact download failed; preserved error in ${errorPath}`);
  }
  return { status };
}

export function collectRunEvidence({
  repo,
  runId,
  evidenceDir,
  suite,
  watchStatus = 0,
  artifactDownloadStatus = 0,
  dryRun = false,
  emit,
}) {
  if (!dryRun) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const commandOptions = { dryRun, emit };
  const runView = captureCommandToFile(
    [
      'gh',
      'run',
      'view',
      runId,
      '--repo',
      repo,
      '--json',
      'databaseId,status,conclusion,event,headBranch,headSha,url,createdAt,updatedAt',
    ],
    resolve(evidenceDir, 'run.json'),
    commandOptions
  );
  const jobsView = captureCommandToFile(
    ['gh', 'run', 'view', runId, '--repo', repo, '--json', 'jobs'],
    resolve(evidenceDir, 'jobs.json'),
    commandOptions
  );
  const artifactsView = captureCommandToFile(
    ['gh', 'api', `repos/${repo}/actions/runs/${runId}/artifacts`],
    resolve(evidenceDir, 'artifact-index.json'),
    commandOptions
  );
  const runLog = captureCommandToFile(
    ['gh', 'run', 'view', runId, '--repo', repo, '--log'],
    resolve(evidenceDir, 'job.log'),
    commandOptions
  );

  const jobsJson = readJsonFile(resolve(evidenceDir, 'jobs.json'), buildDryRunJobsFallback(), {
    dryRun,
  });
  const jobLogStatuses = [];
  for (const jobId of getPrimaryJobIds(jobsJson, { dryRun })) {
    const jobLog = captureCommandToFile(
      ['gh', 'run', 'view', runId, '--repo', repo, '--job', jobId, '--log'],
      resolve(evidenceDir, `job-${jobId}.log`),
      commandOptions
    );
    jobLogStatuses.push({ jobId, status: jobLog.status });
  }

  const logIncomplete =
    runLog.status !== 0 || watchStatus !== 0 || jobLogStatuses.some((job) => job.status !== 0);
  const timing = summarizeRunTiming({
    run: readJsonFile(resolve(evidenceDir, 'run.json'), {}, { dryRun }),
    jobs: jobsJson?.jobs ?? [],
  });
  const runnerMetadata = collectRunnerMetadata(jobsJson?.jobs ?? []);
  const summary = {
    runId,
    suite,
    repo,
    queue_seconds: timing.totals.queueSeconds,
    execution_seconds: timing.totals.executionSeconds,
    runner_name: runnerMetadata.runner_name,
    runner_group_name: runnerMetadata.runner_group_name,
    labels: runnerMetadata.labels,
    skipped_jobs: timing.skippedJobs.map((job) => job.name),
    watch_status: watchStatus,
    artifact_download_status: artifactDownloadStatus,
    run_view_status: runView.status,
    jobs_view_status: jobsView.status,
    artifact_index_status: artifactsView.status,
    run_log_status: runLog.status,
    job_log_statuses: jobLogStatuses,
    log_incomplete: logIncomplete,
  };

  writeEvidenceFile(
    resolve(evidenceDir, 'diagnostic-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { dryRun, emit }
  );

  return summary;
}

export function inspectRunnerState({ repo, runnerName, evidenceDir, dryRun = false, emit } = {}) {
  if (!dryRun) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const statePath = resolve(evidenceDir, 'runner-state.json');
  const result = runGithubCommand(['gh', 'api', `repos/${repo}/actions/runners`, '--paginate'], {
    capture: true,
    dryRun,
    emit,
  });
  const runners = dryRun
    ? [
        {
          name: runnerName,
          status: 'online',
          busy: false,
          labels: [
            { name: 'self-hosted' },
            { name: 'Windows' },
            { name: 'X64' },
            { name: 'proxmox' },
            { name: 'classroompath' },
          ],
        },
      ]
    : (JSON.parse(result || '{"runners":[]}').runners ?? []);
  const runner = runners.find((candidate) => candidate.name === runnerName) ?? null;
  const state = {
    runner_name: runnerName,
    found: Boolean(runner),
    status: runner?.status ?? 'missing',
    busy: Boolean(runner?.busy),
    labels: (runner?.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
  };

  writeEvidenceFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { dryRun, emit });
  return state;
}
