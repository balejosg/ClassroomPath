#!/usr/bin/env node

import {
  OPENPATH_CI_JOB_NAMES,
  classifyRequiredCheckWaitState,
  evaluateRequiredChecks,
  parseRunIdFromUrl,
  resolveOpenPathRequiredChecks,
} from './lib/openpath-ci-checks.mjs';
import { buildGitHubApiHeaders, isDirectExecution } from './lib/github-actions.mjs';
import { gitOutput } from './lib/git-process.mjs';

const DEFAULT_REQUIRED_CHECKS = ['CI Success'];

function usage() {
  console.log(`Usage: node scripts/openpath-required-checks.mjs [wait]

Verifies that the target OpenPath commit has the required GitHub check-runs in success state.

Environment variables:
  OPENPATH_SHA              Commit SHA to verify. Defaults to the local upstream/openpath submodule SHA.
  OPENPATH_BASE_SHA         Optional previous OpenPath SHA used to derive risk-aware required checks.
  OPENPATH_REPO             GitHub repo in owner/name form. Default: balejosg/openpath
  OPENPATH_REQUIRED_CHECKS  Comma-separated explicit override of required check names.
  OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS   Wait mode timeout. Default: 600.
  OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS  Wait mode polling interval. Default: 10.
  OPENPATH_REQUIRED_CHECKS_FAIL_FAST         Wait mode terminal failure behavior. Default: true.
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

function parsePositiveIntegerEnv(env, name, defaultValue) {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

function parseBooleanEnv(env, name, defaultValue) {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return defaultValue;
  }

  switch (rawValue.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
      return true;
    case '0':
    case 'false':
    case 'no':
      return false;
    default:
      throw new Error(`${name} must be true or false`);
  }
}

export function parseWaitOptions(env = process.env) {
  return {
    timeoutSeconds: parsePositiveIntegerEnv(env, 'OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS', 600),
    intervalSeconds: parsePositiveIntegerEnv(env, 'OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS', 10),
    failFast: parseBooleanEnv(env, 'OPENPATH_REQUIRED_CHECKS_FAIL_FAST', true),
  };
}

function resolveOpenPathSha() {
  if (process.env.OPENPATH_SHA) {
    return process.env.OPENPATH_SHA.trim();
  }

  return gitOutput(['rev-parse', 'HEAD:upstream/openpath']);
}

function resolveOpenPathBaseSha() {
  return process.env.OPENPATH_BASE_SHA?.trim() || '';
}

function listOpenPathChangedFiles({ baseSha, sha }) {
  if (!baseSha) {
    return [];
  }

  return gitOutput(['-C', 'upstream/openpath', 'diff', '--name-only', baseSha, sha])
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

const GITHUB_PAGE_SIZE = 100;

export async function fetchCheckRuns({ repo, sha, token }) {
  const checkRuns = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`);
    url.searchParams.set('per_page', String(GITHUB_PAGE_SIZE));
    url.searchParams.set('page', String(page));

    const response = await fetch(url, {
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
    const pageCheckRuns = payload.check_runs ?? [];
    checkRuns.push(...pageCheckRuns);

    if (pageCheckRuns.length < GITHUB_PAGE_SIZE) {
      return checkRuns;
    }

    page += 1;
  }
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

function resolveExecutionContext() {
  const repo = process.env.OPENPATH_REPO?.trim() || 'balejosg/openpath';
  const sha = resolveOpenPathSha();
  const baseSha = resolveOpenPathBaseSha();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const explicitRequiredChecks = process.env.OPENPATH_REQUIRED_CHECKS
    ? parseRequiredChecks(process.env.OPENPATH_REQUIRED_CHECKS)
    : undefined;
  const changedFiles = listOpenPathChangedFiles({ baseSha, sha });
  const requiredCheckResolution = resolveOpenPathRequiredChecks({
    explicitRequiredChecks,
    changedFiles,
  });
  const requiredChecks = requiredCheckResolution.requiredChecks;

  if (!token) {
    throw new Error('GITHUB_TOKEN or GH_TOKEN must be set');
  }

  if (requiredChecks.length === 0) {
    throw new Error('OPENPATH_REQUIRED_CHECKS resolved to an empty list');
  }

  return {
    repo,
    sha,
    token,
    requiredCheckResolution,
    requiredChecks,
  };
}

async function evaluateOpenPathRequiredChecks({ repo, sha, token, requiredChecks }) {
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
  return {
    checkRuns,
    workflowJobs,
    result,
  };
}

function printSuccessSummary({ repo, sha, requiredChecks, requiredCheckResolution }) {
  const riskSummary = requiredCheckResolution.highRisk
    ? `high-risk diff: ${requiredCheckResolution.matchedFiles.join(', ')}`
    : 'low-risk diff';
  console.log(
    `OpenPath required checks passed for ${repo}@${sha}: ${requiredChecks.join(', ')} (${riskSummary})`
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function summarizeWaitState(waitState) {
  if (waitState.pending.length > 0) {
    return `pending: ${waitState.pending.join(', ')}`;
  }

  if (waitState.terminalFailures.length > 0) {
    return `terminal failures: ${waitState.terminalFailures
      .map((failure) => `${failure.name}=${failure.conclusion}`)
      .join(', ')}`;
  }

  return waitState.kind;
}

async function waitForRequiredChecks(context, options) {
  const startedAt = Date.now();
  const timeoutMilliseconds = options.timeoutSeconds * 1000;
  const intervalMilliseconds = options.intervalSeconds * 1000;
  let attempt = 1;

  while (true) {
    const { checkRuns, workflowJobs, result } = await evaluateOpenPathRequiredChecks(context);
    const waitState = classifyRequiredCheckWaitState({
      checkRuns,
      requiredChecks: context.requiredChecks,
      workflowJobs,
    });
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);

    if (waitState.kind === 'passed') {
      printSuccessSummary(context);
      return true;
    }

    if (waitState.kind === 'terminal_failure' && options.failFast) {
      printFailureSummary({ repo: context.repo, sha: context.sha, result });
      console.error(
        `OpenPath required checks reached terminal failure after ${elapsedSeconds}s: ${summarizeWaitState(
          waitState
        )}`
      );
      return false;
    }

    if (Date.now() - startedAt >= timeoutMilliseconds) {
      printFailureSummary({ repo: context.repo, sha: context.sha, result });
      console.error(
        `Timed out after ${elapsedSeconds}s waiting for OpenPath required checks for ${context.repo}@${context.sha}: ${summarizeWaitState(
          waitState
        )}`
      );
      return false;
    }

    console.log(
      `Waiting for OpenPath required checks for ${context.repo}@${context.sha} (attempt ${attempt}, elapsed ${elapsedSeconds}s): ${summarizeWaitState(
        waitState
      )}`
    );

    attempt += 1;
    const remainingMilliseconds = Math.max(0, timeoutMilliseconds - (Date.now() - startedAt));
    await sleep(Math.min(intervalMilliseconds, remainingMilliseconds));
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const command = process.argv[2] ?? 'check';
  if (command !== 'check' && command !== 'wait') {
    throw new Error(`Unknown command: ${command}`);
  }

  const context = resolveExecutionContext();

  if (command === 'wait') {
    const ok = await waitForRequiredChecks(context, parseWaitOptions());
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  const { result } = await evaluateOpenPathRequiredChecks(context);

  if (!result.ok) {
    printFailureSummary({ repo: context.repo, sha: context.sha, result });
    process.exitCode = 1;
    return;
  }

  printSuccessSummary(context);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
