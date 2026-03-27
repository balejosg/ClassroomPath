#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const DEFAULT_REQUIRED_CHECKS = ['CI Success'];
const GITHUB_API_VERSION = '2022-11-28';

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

function parseTimestamp(value) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function selectLatestCheckRuns(checkRuns) {
  const latestByName = new Map();

  for (const checkRun of checkRuns) {
    const previous = latestByName.get(checkRun.name);

    if (!previous) {
      latestByName.set(checkRun.name, checkRun);
      continue;
    }

    const previousTime = parseTimestamp(previous.completed_at ?? previous.started_at);
    const nextTime = parseTimestamp(checkRun.completed_at ?? checkRun.started_at);

    if (nextTime >= previousTime) {
      latestByName.set(checkRun.name, checkRun);
    }
  }

  return latestByName;
}

export function evaluateRequiredChecks({ checkRuns, requiredChecks }) {
  const latestByName = selectLatestCheckRuns(checkRuns);
  const missing = [];
  const failing = [];

  for (const checkName of requiredChecks) {
    const checkRun = latestByName.get(checkName);

    if (!checkRun) {
      missing.push(checkName);
      continue;
    }

    if (checkRun.status !== 'completed' || checkRun.conclusion !== 'success') {
      failing.push({
        name: checkRun.name,
        status: checkRun.status ?? 'unknown',
        conclusion: checkRun.conclusion ?? 'unknown',
      });
    }
  }

  return {
    ok: missing.length === 0 && failing.length === 0,
    missing,
    failing,
  };
}

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
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'classroompath-openpath-required-checks',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API returned ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.check_runs ?? [];
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
  const result = evaluateRequiredChecks({ checkRuns, requiredChecks });

  if (!result.ok) {
    printFailureSummary({ repo, sha, result });
    process.exitCode = 1;
    return;
  }

  console.log(`OpenPath required checks passed for ${repo}@${sha}: ${requiredChecks.join(', ')}`);
}

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  await main();
}
