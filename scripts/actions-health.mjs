#!/usr/bin/env node

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isDirectExecution } from './lib/github-actions.mjs';
import { classifyWorkflowRunHealth } from './lib/github-actions-health.mjs';

const execFile = promisify(nodeExecFile);
const GH_RUN_VIEW_FIELDS = 'status,conclusion,jobs,updatedAt,url';
const GH_RUN_LIST_FIELDS =
  'databaseId,status,conclusion,headSha,headBranch,event,createdAt,updatedAt,url,name,workflowName';
const DEFAULT_WAIT_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_WAIT_INTERVAL_SECONDS = 15;
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
const GATE_WORKFLOW_NAMES = new Set(['Deploy', 'Release Candidate Images']);

function usage() {
  return `Usage:
  node scripts/actions-health.mjs classify --repo <owner/name> --run-id <id> [--json]
  node scripts/actions-health.mjs wait --repo <owner/name> --run-id <id> [--timeout-seconds <n>] [--interval-seconds <n>] [--json]
  node scripts/actions-health.mjs report-stale --repo <owner/name> --sha <sha> [--tag <tag>] [--json]

Classifies GitHub Actions workflow runs for stale or corrupt states using:
  gh run view <id> --repo <repo> --json ${GH_RUN_VIEW_FIELDS}
`;
}

export async function runActionsHealthCommand(argv = process.argv, dependencies = {}) {
  const io = {
    stdout: dependencies.stdout ?? ((value) => process.stdout.write(value)),
    stderr: dependencies.stderr ?? ((value) => process.stderr.write(value)),
  };

  try {
    const options = parseArgs(argv.slice(2));
    const result = await runSelectedCommand(options, dependencies);

    printResult(result, options, io);
    return { status: exitStatusForResult(result) };
  } catch (error) {
    io.stderr(`${error.message}\n\n${usage()}`);
    return { status: 2 };
  }
}

export function parseArgs(args) {
  const [command, ...rest] = args;

  if (command !== 'classify' && command !== 'wait' && command !== 'report-stale') {
    throw new Error('command must be classify, wait, or report-stale');
  }

  const options = {
    command,
    json: false,
    repo: '',
    runId: '',
    sha: '',
    tag: '',
    timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS,
    intervalSeconds: DEFAULT_WAIT_INTERVAL_SECONDS,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--repo':
        options.repo = requireNextValue(rest, ++index, '--repo');
        break;
      case '--run-id':
        options.runId = requireNextValue(rest, ++index, '--run-id');
        break;
      case '--sha':
        options.sha = requireNextValue(rest, ++index, '--sha');
        break;
      case '--tag':
        options.tag = requireNextValue(rest, ++index, '--tag');
        break;
      case '--timeout-seconds':
        options.timeoutSeconds = parsePositiveInteger(
          requireNextValue(rest, ++index, '--timeout-seconds'),
          '--timeout-seconds'
        );
        break;
      case '--interval-seconds':
        options.intervalSeconds = parsePositiveInteger(
          requireNextValue(rest, ++index, '--interval-seconds'),
          '--interval-seconds'
        );
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.repo) {
    throw new Error('--repo is required');
  }

  if ((options.command === 'classify' || options.command === 'wait') && !options.runId) {
    throw new Error('--run-id is required');
  }

  if (options.command === 'report-stale' && !options.sha && !options.tag) {
    throw new Error('--sha or --tag is required');
  }

  return options;
}

async function runSelectedCommand(options, dependencies) {
  if (options.command === 'wait') {
    return waitForRunHealth(options, dependencies);
  }

  if (options.command === 'report-stale') {
    return reportStaleRuns(options, dependencies);
  }

  return classifyRun(options, dependencies);
}

async function classifyRun(options, dependencies) {
  const run = await fetchWorkflowRun(options, dependencies);
  return buildOutput({ options, run, health: classifyRunPayload(run, dependencies) });
}

async function waitForRunHealth(options, dependencies) {
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadlineMs = nowMs() + options.timeoutSeconds * 1000;
  let latestResult = null;

  while (nowMs() <= deadlineMs) {
    const run = await fetchWorkflowRun(options, dependencies);
    latestResult = buildOutput({ options, run, health: classifyRunPayload(run, dependencies) });

    if (isTerminalState(latestResult.state)) {
      return latestResult;
    }

    await sleep(options.intervalSeconds * 1000);
  }

  return {
    ...latestResult,
    state: 'timeout',
    recommendedAction: 'inspect-runner-logs',
    reason: `workflow did not reach a terminal state within ${options.timeoutSeconds} seconds`,
  };
}

function classifyRunPayload(run, dependencies) {
  const nowMs = dependencies.nowMs?.();
  return classifyWorkflowRunHealth(nowMs === undefined ? run : { ...run, nowMs });
}

async function fetchWorkflowRun(options, dependencies) {
  const runExecFile = dependencies.execFile ?? execFile;
  const result = await runExecFile('gh', [
    'run',
    'view',
    options.runId,
    '--repo',
    options.repo,
    '--json',
    GH_RUN_VIEW_FIELDS,
  ]);

  return JSON.parse(String(result.stdout ?? ''));
}

async function reportStaleRuns(options, dependencies) {
  try {
    const runs = await fetchResidualRunCandidates(options, dependencies);
    const candidateRuns = filterResidualRunCandidates(runs, {
      sha: options.sha,
      tag: options.tag,
    });
    const enrichedRuns = await enrichRunsWithJobs(candidateRuns, options, dependencies);
    const nowMs = dependencies.nowMs?.() ?? Date.now();
    const residualRuns = findResidualUnhealthyRuns(enrichedRuns, {
      sha: options.sha,
      tag: options.tag,
      nowMs,
    });

    return {
      repo: options.repo,
      sha: options.sha,
      tag: options.tag,
      state: residualRuns.length > 0 ? 'reported' : 'healthy',
      staleRuns: residualRuns,
      reason:
        residualRuns.length > 0
          ? `reported ${residualRuns.length} residual stale/corrupt non-gate run(s)`
          : 'no residual stale/corrupt non-gate runs found',
    };
  } catch (error) {
    return {
      repo: options.repo,
      sha: options.sha,
      tag: options.tag,
      state: 'unavailable',
      staleRuns: [],
      reason: `residual Actions run report unavailable: ${error.message}`,
    };
  }
}

async function fetchResidualRunCandidates(options, dependencies) {
  const runExecFile = dependencies.execFile ?? execFile;
  const runsById = new Map();
  const queries = [];

  if (options.tag) {
    queries.push(['run', 'list', '--repo', options.repo, '--branch', options.tag, '--limit', '50']);
  }
  if (options.sha) {
    queries.push(['run', 'list', '--repo', options.repo, '--limit', '100']);
  }

  for (const query of queries) {
    const result = await runExecFile('gh', [...query, '--json', GH_RUN_LIST_FIELDS]);
    const runs = JSON.parse(String(result.stdout ?? '[]'));
    for (const run of Array.isArray(runs) ? runs : []) {
      const id = String(run.databaseId ?? run.id ?? '');
      if (id) {
        runsById.set(id, run);
      }
    }
  }

  return [...runsById.values()];
}

async function enrichRunsWithJobs(runs, options, dependencies) {
  const enrichedRuns = [];

  for (const run of runs) {
    const runId = String(run.databaseId ?? run.id ?? '');
    if (!runId) {
      enrichedRuns.push(run);
      continue;
    }

    try {
      const viewedRun = await fetchWorkflowRun({ ...options, runId }, dependencies);
      enrichedRuns.push({ ...run, jobs: viewedRun.jobs ?? [] });
    } catch {
      enrichedRuns.push(run);
    }
  }

  return enrichedRuns;
}

function findResidualUnhealthyRuns(runs, { sha, tag, nowMs }) {
  return filterResidualRunCandidates(runs, { sha, tag })
    .map((run) => buildResidualRunHealth(run, nowMs))
    .filter((run) => run.state === 'stale' || run.state === 'corrupt');
}

function filterResidualRunCandidates(runs, { sha, tag }) {
  const normalizedSha = String(sha ?? '').trim();
  const normalizedTag = String(tag ?? '').trim();

  return runs
    .filter((run) => matchesShaOrTag(run, normalizedSha, normalizedTag))
    .filter((run) => !GATE_WORKFLOW_NAMES.has(workflowNameForRun(run)));
}

function buildResidualRunHealth(run, nowMs) {
  const health = classifyResidualRunHealth(run, nowMs);
  return {
    databaseId: run.databaseId ?? run.id ?? null,
    workflowName: workflowNameForRun(run),
    status: run.status ?? '',
    conclusion: run.conclusion ?? '',
    headSha: run.headSha ?? '',
    headBranch: run.headBranch ?? '',
    createdAt: run.createdAt ?? '',
    updatedAt: run.updatedAt ?? '',
    url: run.url ?? '',
    state: health.state,
    reason: health.reason,
    recommendedAction: health.recommendedAction,
    jobs: health.jobs,
  };
}

function classifyResidualRunHealth(run, nowMs) {
  const queuedSinceMs = Date.parse(run.createdAt ?? run.updatedAt ?? '');
  if (
    run.status === 'queued' &&
    Number.isFinite(queuedSinceMs) &&
    nowMs - queuedSinceMs > DEFAULT_STALE_AFTER_MS
  ) {
    return {
      state: 'stale',
      recommendedAction: 'inspect-runner-logs',
      reason: `workflow queued longer than stale threshold since ${run.createdAt ?? run.updatedAt}`,
      jobs: [],
    };
  }

  return classifyWorkflowRunHealth({ ...run, nowMs, staleAfterMs: DEFAULT_STALE_AFTER_MS });
}

function buildOutput({ options, run, health }) {
  return {
    repo: options.repo,
    runId: options.runId,
    status: run.status ?? '',
    conclusion: run.conclusion ?? '',
    updatedAt: run.updatedAt ?? '',
    url: run.url ?? '',
    state: health.state,
    recommendedAction: health.recommendedAction,
    reason: health.reason,
    jobs: health.jobs,
    cancelable: health.cancelable,
  };
}

function printResult(result, options, io) {
  if (options.json) {
    io.stdout(`${JSON.stringify(result)}\n`);
    return;
  }

  io.stdout(
    options.command === 'report-stale'
      ? formatResidualRunsReport(result)
      : formatHumanResult(result)
  );
}

function formatHumanResult(result) {
  const lines = [
    `GitHub Actions run ${result.runId} (${result.repo})`,
    `state: ${result.state}`,
    `status: ${result.status}`,
    `conclusion: ${result.conclusion || 'none'}`,
    `recommended_action: ${result.recommendedAction}`,
    `cancelable: ${result.cancelable ? 'true' : 'false'}`,
    `reason: ${result.reason}`,
  ];

  if (result.jobs.length > 0) {
    lines.push(`jobs: ${result.jobs.join(', ')}`);
  }

  if (result.updatedAt) {
    lines.push(`updated_at: ${result.updatedAt}`);
  }

  if (result.url) {
    lines.push(`url: ${result.url}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatResidualRunsReport(result) {
  const lines = ['Residual non-blocking Actions runs:'];

  if (result.state === 'unavailable') {
    lines.push(`- unavailable: ${result.reason}`);
    return `${lines.join('\n')}\n`;
  }

  if (result.staleRuns.length === 0) {
    lines.push('- none found');
    return `${lines.join('\n')}\n`;
  }

  for (const run of result.staleRuns) {
    const workflow = run.workflowName || 'unknown workflow';
    const runId = run.databaseId ?? 'unknown';
    const since = run.createdAt || run.updatedAt || 'unknown time';
    const url = run.url ? ` ${run.url}` : '';
    lines.push(
      `- ${workflow} ${runId} ${run.status || run.state} since ${since}; ${run.reason}; not part of production gate.${url}`
    );
  }

  return `${lines.join('\n')}\n`;
}

function isTerminalState(state) {
  return ['healthy', 'failed', 'stale', 'corrupt'].includes(state);
}

function exitStatusForResult(result) {
  if (result.state === 'reported' || result.state === 'unavailable') {
    return 0;
  }

  return result.state === 'healthy' ? 0 : 1;
}

function requireNextValue(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, name) {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsedValue;
}

function matchesShaOrTag(run, sha, tag) {
  return (
    (hasValue(sha) && String(run.headSha ?? '') === sha) ||
    (hasValue(tag) && String(run.headBranch ?? '') === tag)
  );
}

function workflowNameForRun(run) {
  return String(run.workflowName ?? run.name ?? '').trim();
}

function hasValue(input) {
  return String(input ?? '').trim().length > 0;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runActionsHealthCommand(process.argv);
  process.exitCode = result.status;
}
