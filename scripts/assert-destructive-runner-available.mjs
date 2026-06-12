#!/usr/bin/env node

/**
 * Asserts that no blocking destructive-runner job is currently in progress before starting a new Windows canary run.
 *
 * Invoked by: GitHub Actions `windows-production-bootstrap-canary.yml` and `production-client-update-canary.yml` workflows.
 * Usage: node scripts/assert-destructive-runner-available.mjs
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */

import process from 'node:process';

import {
  DEFAULT_DESTRUCTIVE_WINDOWS_JOB_NAMES,
  findBlockingDestructiveRunnerJobs,
  formatBlockingDestructiveRunnerMessage,
} from './lib/destructive-runner-guard.mjs';

function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY ?? '',
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
    currentRunId: process.env.GITHUB_RUN_ID ?? '',
    destructiveJobNames: [...DEFAULT_DESTRUCTIVE_WINDOWS_JOB_NAMES],
    requiredLabels: ['self-hosted', 'Windows', 'classroompath'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--repository') {
      options.repository = next();
    } else if (arg === '--api-url') {
      options.apiUrl = next();
    } else if (arg === '--token') {
      options.token = next();
    } else if (arg === '--current-run-id') {
      options.currentRunId = next();
    } else if (arg === '--job-name') {
      options.destructiveJobNames.push(next());
    } else if (arg === '--required-labels') {
      options.requiredLabels = parseList(next());
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/assert-destructive-runner-available.mjs [options]

Options:
  --repository <owner/repo>     GitHub repository (default: GITHUB_REPOSITORY)
  --current-run-id <id>        Current run id to ignore (default: GITHUB_RUN_ID)
  --job-name <name>            Additional destructive job name to guard
  --required-labels <csv>      Required runner labels (default: self-hosted,Windows,classroompath)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadRunsAndJobs(options) {
  const runs = [];
  const jobsByRunId = new Map();
  const baseUrl = options.apiUrl.replace(/\/$/, '');
  const repositoryPath = encodeURIComponent(options.repository).replace('%2F', '/');

  for (const status of ['queued', 'in_progress']) {
    const runsUrl = `${baseUrl}/repos/${repositoryPath}/actions/runs?status=${status}&per_page=100`;
    const payload = await githubJson(runsUrl, options.token);
    runs.push(...(payload.workflow_runs ?? []));
  }

  await Promise.all(
    runs.map(async (run) => {
      const jobsUrl = `${baseUrl}/repos/${repositoryPath}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`;
      const payload = await githubJson(jobsUrl, options.token);
      jobsByRunId.set(String(run.id), payload.jobs ?? []);
    })
  );

  return { runs, jobsByRunId };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.repository) {
    throw new Error('GITHUB_REPOSITORY or --repository is required');
  }
  if (!options.token) {
    throw new Error('GITHUB_TOKEN or --token is required');
  }
  if (!options.currentRunId) {
    throw new Error('GITHUB_RUN_ID or --current-run-id is required');
  }

  const { runs, jobsByRunId } = await loadRunsAndJobs(options);
  const blockingJobs = findBlockingDestructiveRunnerJobs({
    runs,
    jobsByRunId,
    currentRunId: options.currentRunId,
    destructiveJobNames: options.destructiveJobNames,
    requiredLabels: options.requiredLabels,
  });

  if (blockingJobs.length > 0) {
    console.error(formatBlockingDestructiveRunnerMessage(blockingJobs));
    process.exit(1);
  }

  console.log('No active destructive Windows runner job detected for this runner label set.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
