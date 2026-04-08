#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  OPENPATH_CI_JOB_NAMES,
  evaluateRequiredChecks,
  parseRunIdFromUrl,
} from './lib/openpath-ci-checks.mjs';
import { buildGitHubApiHeaders, isDirectExecution } from './lib/github-actions.mjs';

const DEFAULT_REQUIRED_CHECKS = ['CI Success'];

function usage() {
  console.log(`Usage: node scripts/openpath-required-checks.mjs

Verifies that the target OpenPath commit has the required GitHub check-runs in success state.

Environment variables:
  OPENPATH_SHA              Commit SHA to verify. Defaults to the local upstream/openpath submodule SHA.
  OPENPATH_REPO             GitHub repo in owner/name form. Default: balejosg/openpath
  OPENPATH_REQUIRED_CHECKS  Comma-separated list of required check names.
  GITHUB_TOKEN or GH_TOKEN  Token used to query the GitHub API.
`);
}

export function parseRequiredChecks(rawValue) {
  const source = rawValue ?? DEFAULT_REQUIRED_CHECKS.join(',');
  return source
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export { evaluateRequiredChecks } from './lib/openpath-ci-checks.mjs';

function resolveOpenPathSha() {
  if (process.env.OPENPATH_SHA) {
    return process.env.OPENPATH_SHA.trim();
  }

  return execFileSync('git', ['rev-parse', 'HEAD:upstream/openpath'], {
    encoding: 'utf8',
  }).trim();
}

async function fetchCheckRuns({ repo, sha, token }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`, {
    headers: buildGitHubApiHeaders({
      token,
      userAgent: 'classroompath-openpath-required-checks',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API returned ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.check_runs ?? [];
}

function selectLatestOpenPathCiRunId(checkRuns) {
  let latestRunId = null;
  let latestTime = 0;

  for (const checkRun of checkRuns) {
    if (!OPENPATH_CI_JOB_NAMES.includes(checkRun.name)) {
      continue;
    }

    const runId = parseRunIdFromUrl(checkRun.details_url ?? checkRun.html_url ?? '');
    if (!runId) {
      continue;
    }

    const timestamp = Date.parse(checkRun.completed_at ?? checkRun.started_at ?? '') || 0;
    if (timestamp >= latestTime) {
      latestTime = timestamp;
      latestRunId = runId;
    }
  }

  return latestRunId;
}

async function fetchWorkflowRunJobs({ repo, runId, token }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`, {
    headers: buildGitHubApiHeaders({
      token,
      userAgent: 'classroompath-openpath-required-checks',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Actions jobs API returned ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.jobs ?? [];
}

function printFailureSummary({ repo, sha, result }) {
  console.error(`OpenPath required checks failed for ${repo}@${sha}`);

  if (result.missing.length > 0) {
    console.error(`Missing checks: ${result.missing.join(', ')}`);
  }

  for (const failing of result.failing) {
    console.error(`Check ${failing.name} is ${failing.conclusion} (status: ${failing.status})`);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const repo = process.env.OPENPATH_REPO?.trim() || 'balejosg/openpath';
  const sha = resolveOpenPathSha();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const requiredChecks = parseRequiredChecks(process.env.OPENPATH_REQUIRED_CHECKS);

  if (!token) {
    throw new Error('GITHUB_TOKEN or GH_TOKEN must be set');
  }

  if (requiredChecks.length === 0) {
    throw new Error('OPENPATH_REQUIRED_CHECKS resolved to an empty list');
  }

  const checkRuns = await fetchCheckRuns({ repo, sha, token });
  let workflowJobs = [];
  const requiresCiSuccess = requiredChecks.includes('CI Success');

  if (requiresCiSuccess) {
    const runId = selectLatestOpenPathCiRunId(checkRuns);
    if (runId) {
      workflowJobs = await fetchWorkflowRunJobs({ repo, runId, token });
    }
  }

  const result = evaluateRequiredChecks({ checkRuns, requiredChecks, workflowJobs });

  if (!result.ok) {
    printFailureSummary({ repo, sha, result });
    process.exitCode = 1;
    return;
  }

  console.log(`OpenPath required checks passed for ${repo}@${sha}: ${requiredChecks.join(', ')}`);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
