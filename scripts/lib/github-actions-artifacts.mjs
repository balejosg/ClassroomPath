/**
 * Helpers for listing, downloading, and polling GitHub Actions artifacts with retry and timeout formatting.
 *
 * Invoked by: Imported by canary, release, and wait scripts; tested by `github-actions-artifacts.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const GITHUB_CLI_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const GITHUB_ARTIFACTS_JQ =
  '{artifacts: [.artifacts[] | {id, name, expired, created_at, updated_at, expires_at, workflow_run: {id: .workflow_run.id}}]}';

/** @typedef {import('node:child_process').StdioOptions} StdioOptions */
/** @typedef {{cwd?: string; stdio?: StdioOptions}} GitHubCliOptions */
/** @typedef {Record<string, unknown> & {
 *   databaseId?: string|number;
 *   id?: string|number;
 *   runId?: string|number;
 *   headSha?: string|null;
 *   status?: string|null;
 *   conclusion?: string|null;
 *   event?: string|null;
 *   workflowName?: string|null;
 *   name?: string|null;
 *   createdAt?: string|null;
 *   updatedAt?: string|null;
 *   url?: string|null;
 *   html_url?: string|null;
 * }} GitHubWorkflowRun */
/** @typedef {Record<string, unknown> & {
 *   id?: string|number;
 *   databaseId?: string|number;
 *   name?: string|null;
 *   expired?: boolean|null;
 *   created_at?: string|null;
 *   updated_at?: string|null;
 *   expires_at?: string|null;
 *   workflow_run?: {id?: string|number};
 * }} GitHubArtifact */
/** @typedef {Record<string, unknown> & {
 *   name?: string|null;
 *   status?: string|null;
 *   conclusion?: string|null;
 *   databaseId?: string|number;
 *   createdAt?: string|null;
 *   startedAt?: string|null;
 *   completedAt?: string|null;
 *   steps?: GitHubStep[];
 * }} GitHubJob */
/** @typedef {Record<string, unknown> & {
 *   name?: string|null;
 *   status?: string|null;
 *   conclusion?: string|null;
 *   number?: number|null;
 *   completedAt?: string|null;
 * }} GitHubStep */
/** @typedef {{jobs: GitHubJob[]}} GitHubRunJobsResponse */
/** @typedef {{artifacts: GitHubArtifact[]}} GitHubArtifactsResponse */
/** @typedef {Record<string, unknown> & {
 *   lastState?: string;
 *   latestRun?: GitHubWorkflowRun|null;
 *   latestRunJobs?: GitHubJob[];
 *   openPathRecoveryDecision?: Record<string, unknown>|null;
 *   lastSuccessfulRunWithoutArtifact?: GitHubWorkflowRun|null;
 * }} ArtifactResolutionContext */
/** @template T @typedef {{status: 'resolved'; value: T}|{status: 'pending'; context?: ArtifactResolutionContext}} ArtifactAttempt */
/** @typedef {{repo: string; runId: string|number; artifactName: string; cwd?: string; tempPrefix?: string; outputDir?: string}} TryDownloadArtifactOptions */
/** @typedef {{found: true; artifactDir: string}|{found: false; artifactDir: null}} TryDownloadArtifactResult */
/**
 * @template T
 * @typedef {object} ArtifactResolutionOptions
 * @property {number} [timeoutSeconds]
 * @property {number} [intervalSeconds]
 * @property {(context: ArtifactResolutionContext) => ArtifactAttempt<T>|undefined|void} [attempt]
 * @property {(context: ArtifactResolutionContext) => void} [onPending]
 * @property {(context: ArtifactResolutionContext) => unknown} [formatTimeoutError]
 */

/**
 * @param {string[]} args
 * @param {GitHubCliOptions} [options]
 * @returns {string}
 */
function runGitHubCli(args, { cwd, stdio = ['ignore', 'pipe', 'pipe'] } = {}) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: GITHUB_CLI_MAX_BUFFER_BYTES,
    stdio,
  });
}

/**
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 * @returns {Buffer}
 */
function runGitHubCliBuffer(args, { cwd } = {}) {
  return execFileSync('gh', args, {
    cwd,
    maxBuffer: GITHUB_CLI_MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * @param {{repo: string; artifactName: string; perPage?: number}} params
 * @returns {string[]}
 */
export function buildListGitHubArtifactsArgs({ repo, artifactName, perPage = 100 }) {
  return [
    'api',
    `repos/${repo}/actions/artifacts?per_page=${String(perPage)}&name=${encodeURIComponent(artifactName)}`,
    '--jq',
    GITHUB_ARTIFACTS_JQ,
  ];
}

/**
 * @param {{repo: string; artifactId: string|number}} params
 * @returns {string[]}
 */
export function buildDownloadArtifactZipArgs({ repo, artifactId }) {
  return ['api', `repos/${repo}/actions/artifacts/${artifactId}/zip`];
}

/**
 * @param {{repo: string; runId: string|number}} params
 * @returns {string[]}
 */
export function buildViewGitHubRunJobsArgs({ repo, runId }) {
  return ['run', 'view', String(runId), '--repo', repo, '--json', 'jobs'];
}

/**
 * @param {{repo: string; runId: string|number}} params
 * @returns {string[]}
 */
export function buildViewGitHubWorkflowRunArgs({ repo, runId }) {
  return [
    'run',
    'view',
    String(runId),
    '--repo',
    repo,
    '--json',
    'databaseId,headSha,status,conclusion,event,workflowName,name,createdAt,updatedAt',
  ];
}

/**
 * @param {{repo: string; runId: string|number}} params
 * @returns {string[]}
 */
export function buildViewGitHubRunFailedLogArgs({ repo, runId }) {
  return ['run', 'view', String(runId), '--repo', repo, '--log-failed'];
}

/**
 * @param {{repo: string; runId: string|number}} params
 * @returns {string[]}
 */
export function buildRerunGitHubRunArgs({ repo, runId }) {
  return ['run', 'rerun', String(runId), '--repo', repo, '--failed'];
}

/** @param {number} milliseconds */
export function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * @param {{repo: string; workflow: string; sha?: string; cwd?: string; limit?: number}} params
 * @returns {GitHubWorkflowRun[]}
 */
export function listGitHubWorkflowRuns({ repo, workflow, sha, cwd, limit = 30 }) {
  const args = [
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    workflow,
    '--limit',
    String(limit),
    '--json',
    'databaseId,headSha,status,conclusion,event,createdAt,updatedAt',
  ];

  if (sha) {
    args.splice(8, 0, '--commit', sha);
  }

  const output = runGitHubCli(args, { cwd }).trim();

  /** @type {GitHubWorkflowRun[]} */
  const parsed = JSON.parse(output || '[]');
  return parsed;
}

/**
 * @param {{repo: string; runId: string|number; cwd?: string}} params
 * @returns {GitHubRunJobsResponse}
 */
export function viewGitHubRunJobs({ repo, runId, cwd }) {
  const output = runGitHubCli(buildViewGitHubRunJobsArgs({ repo, runId }), { cwd }).trim();

  /** @type {GitHubRunJobsResponse} */
  const parsed = JSON.parse(output || '{"jobs":[]}');
  return parsed;
}

/**
 * @param {{repo: string; runId: string|number; cwd?: string}} params
 * @returns {GitHubWorkflowRun}
 */
export function viewGitHubWorkflowRun({ repo, runId, cwd }) {
  const output = runGitHubCli(buildViewGitHubWorkflowRunArgs({ repo, runId }), { cwd }).trim();
  /** @type {GitHubWorkflowRun} */
  const parsed = JSON.parse(output || '{}');
  return parsed;
}

/**
 * @param {{repo: string; runId: string|number; cwd?: string}} params
 * @returns {string}
 */
export function viewGitHubRunFailedLog({ repo, runId, cwd }) {
  try {
    return runGitHubCli(buildViewGitHubRunFailedLogArgs({ repo, runId }), { cwd }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {{repo: string; runId: string|number; cwd?: string}} params
 * @returns {void}
 */
export function rerunGitHubRunFailedJobs({ repo, runId, cwd }) {
  runGitHubCli(buildRerunGitHubRunArgs({ repo, runId }), { cwd, stdio: 'inherit' });
}

/**
 * @param {{repo: string; artifactName: string; cwd?: string; perPage?: number}} params
 * @returns {GitHubArtifactsResponse}
 */
export function listGitHubArtifacts({ repo, artifactName, cwd, perPage = 100 }) {
  const output = runGitHubCli(buildListGitHubArtifactsArgs({ repo, artifactName, perPage }), {
    cwd,
  }).trim();

  /** @type {GitHubArtifactsResponse} */
  const parsed = JSON.parse(output || '{"artifacts":[]}');
  return parsed;
}

/** @param {string} [prefix] */
export function createTemporaryArtifactDir(prefix = 'classroompath-artifact-') {
  return mkdtempSync(resolve(tmpdir(), prefix));
}

/** @param {string|null|undefined} artifactDir */
export function cleanupTemporaryArtifactDir(artifactDir) {
  if (!artifactDir) {
    return;
  }

  rmSync(artifactDir, { recursive: true, force: true });
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireArtifactArgument(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required to download a GitHub artifact`);
  }
  return normalized;
}

/**
 * @param {{repo?: string; runId?: string|number; artifactName?: string; cwd?: string; tempPrefix?: string}} [params]
 * @returns {{artifactDir: string}}
 */
export function downloadRunArtifact({ repo, runId, artifactName, cwd, tempPrefix } = {}) {
  const cliRepo = requireArtifactArgument(repo, 'repo');
  const cliRunId = requireArtifactArgument(runId, 'runId');
  const cliArtifactName = requireArtifactArgument(artifactName, 'artifactName');
  const artifactDir = createTemporaryArtifactDir(tempPrefix);

  try {
    runGitHubCli(
      [
        'run',
        'download',
        cliRunId,
        '--repo',
        cliRepo,
        '--name',
        cliArtifactName,
        '--dir',
        artifactDir,
      ],
      {
        cwd,
      }
    );

    return { artifactDir };
  } catch (error) {
    cleanupTemporaryArtifactDir(artifactDir);
    throw error;
  }
}

/**
 * Missing arguments retain the legacy best-effort behavior: the empty typed
 * request is rejected by the validating downloader and converted to found:false.
 * @type {(params: TryDownloadArtifactOptions) => TryDownloadArtifactResult}
 */
export const tryDownloadRunArtifact = (params = { repo: '', runId: '', artifactName: '' }) => {
  const normalizedParams = params;

  try {
    return {
      found: true,
      ...downloadRunArtifact(normalizedParams),
    };
  } catch {
    return {
      found: false,
      artifactDir: null,
    };
  }
};

/**
 * @param {{repo?: string; artifactId?: string|number; cwd?: string; tempPrefix?: string}} [params]
 * @returns {{artifactDir: string}}
 */
export function downloadArtifactById({ repo, artifactId, cwd, tempPrefix } = {}) {
  const cliRepo = requireArtifactArgument(repo, 'repo');
  const cliArtifactId = requireArtifactArgument(artifactId, 'artifactId');
  const artifactDir = createTemporaryArtifactDir(tempPrefix);
  const artifactArchivePath = resolve(artifactDir, 'artifact.zip');

  try {
    writeFileSync(
      artifactArchivePath,
      runGitHubCliBuffer(
        buildDownloadArtifactZipArgs({ repo: cliRepo, artifactId: cliArtifactId }),
        { cwd }
      )
    );
    execFileSync('unzip', ['-oq', artifactArchivePath, '-d', artifactDir], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { artifactDir };
  } catch (error) {
    cleanupTemporaryArtifactDir(artifactDir);
    throw error;
  }
}

/**
 * @param {{artifactDir: string; fileName: string}} params
 * @returns {string}
 */
export function readArtifactTextFile({ artifactDir, fileName }) {
  return readFileSync(resolve(artifactDir, fileName), 'utf8');
}

/**
 * @param {{artifactDir: string; outputDir: string}} params
 * @returns {void}
 */
export function copyArtifactContents({ artifactDir, outputDir }) {
  mkdirSync(outputDir, { recursive: true });
  for (const entry of readdirSync(artifactDir)) {
    cpSync(resolve(artifactDir, entry), resolve(outputDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

/**
 * @template T
 * @param {ArtifactResolutionOptions<T>} [options]
 * @returns {T}
 */
export function waitForArtifactResolution({
  timeoutSeconds = 900,
  intervalSeconds = 10,
  attempt,
  onPending,
  formatTimeoutError,
} = {}) {
  if (typeof attempt !== 'function') {
    throw new Error('Artifact resolution attempt callback is required');
  }

  if (typeof formatTimeoutError !== 'function') {
    throw new Error('Artifact timeout formatter is required');
  }

  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  /** @type {ArtifactResolutionContext} */
  let timeoutContext = {};

  while (true) {
    const result = attempt(timeoutContext) ?? { status: 'pending' };

    if (result.status === 'resolved') {
      return result.value;
    }

    timeoutContext = result.context ?? timeoutContext;

    if (typeof onPending === 'function') {
      onPending(timeoutContext);
    }

    if (Date.now() >= deadline) {
      const message = formatTimeoutError(timeoutContext);
      throw new Error(message === undefined ? undefined : String(message));
    }

    sleep(intervalMs);
  }
}
