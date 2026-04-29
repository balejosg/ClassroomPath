import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  emit,
  error = console.error,
}) {
  const result = runGithubCommand(
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
  if (typeof result === 'object' && status !== 0) {
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

  const jobsJson = readJsonFile(
    resolve(evidenceDir, 'jobs.json'),
    {
      jobs: [{ databaseId: '<job-id>' }],
    },
    { dryRun }
  );
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
  const summary = {
    runId,
    suite,
    repo,
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
