#!/usr/bin/env node

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isDirectExecution } from './lib/github-actions.mjs';
import { classifyWorkflowRunHealth } from './lib/github-actions-health.mjs';

const execFile = promisify(nodeExecFile);
const GH_RUN_VIEW_FIELDS = 'status,conclusion,jobs,updatedAt,url';
const DEFAULT_WAIT_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_WAIT_INTERVAL_SECONDS = 15;

function usage() {
  return `Usage:
  node scripts/actions-health.mjs classify --repo <owner/name> --run-id <id> [--json]
  node scripts/actions-health.mjs wait --repo <owner/name> --run-id <id> [--timeout-seconds <n>] [--interval-seconds <n>] [--json]

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
    const result =
      options.command === 'wait'
        ? await waitForRunHealth(options, dependencies)
        : await classifyRun(options, dependencies);

    printResult(result, options, io);
    return { status: exitStatusForResult(result) };
  } catch (error) {
    io.stderr(`${error.message}\n\n${usage()}`);
    return { status: 2 };
  }
}

export function parseArgs(args) {
  const [command, ...rest] = args;

  if (command !== 'classify' && command !== 'wait') {
    throw new Error('command must be classify or wait');
  }

  const options = {
    command,
    json: false,
    repo: '',
    runId: '',
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

  if (!options.runId) {
    throw new Error('--run-id is required');
  }

  return options;
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

  io.stdout(formatHumanResult(result));
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

function isTerminalState(state) {
  return ['healthy', 'failed', 'stale', 'corrupt'].includes(state);
}

function exitStatusForResult(result) {
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

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runActionsHealthCommand(process.argv);
  process.exitCode = result.status;
}
