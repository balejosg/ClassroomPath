#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const DURATION_PATTERN = /^(\d+)(m|h|d)$/;

export function parseFreshnessWindow(value) {
  const match = String(value ?? '')
    .trim()
    .match(DURATION_PATTERN);
  if (!match) {
    throw new Error(`Unsupported freshness window: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

export function findFreshSameShaSuccess({
  runs,
  sha,
  currentRunId,
  now = new Date(),
  freshnessMs,
}) {
  const cutoffMs = now.getTime() - freshnessMs;

  return runs.find((run) => {
    const runId = String(run.databaseId ?? run.id ?? '');
    const updatedAt = Date.parse(String(run.updatedAt ?? run.createdAt ?? ''));

    return (
      runId !== String(currentRunId ?? '') &&
      run.event === 'schedule' &&
      run.headSha === sha &&
      run.status === 'completed' &&
      run.conclusion === 'success' &&
      Number.isFinite(updatedAt) &&
      updatedAt >= cutoffMs
    );
  });
}

export function resolveDuplicateSuppression({
  eventName,
  runs,
  sha,
  currentRunId,
  now = new Date(),
  freshnessWindow,
}) {
  if (eventName !== 'schedule') {
    return {
      shouldSkip: false,
      reason: `event ${eventName} is not eligible for same-SHA suppression`,
    };
  }

  const freshnessMs = parseFreshnessWindow(freshnessWindow);
  const matchingRun = findFreshSameShaSuccess({
    runs,
    sha,
    currentRunId,
    now,
    freshnessMs,
  });

  if (!matchingRun) {
    return {
      shouldSkip: false,
      reason: `no fresh scheduled success for ${sha} within ${freshnessWindow}`,
    };
  }

  return {
    shouldSkip: true,
    reason: `fresh scheduled success ${matchingRun.databaseId ?? matchingRun.id} already covered ${sha}`,
    run: matchingRun,
  };
}

function ghRunList({ workflowName, limit }) {
  const stdout = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      workflowName,
      '--event',
      'schedule',
      '--branch',
      'main',
      '--limit',
      String(limit),
      '--json',
      'databaseId,status,conclusion,headSha,event,updatedAt,url,name',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  return JSON.parse(stdout);
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${name}=${value}`);
    return;
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function writeSummary({ signalClass, duplicatePolicy, result }) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### CI signal policy',
      '',
      `- Signal class: ${signalClass}`,
      `- Duplicate policy: ${duplicatePolicy}`,
      `- Decision: ${result.shouldSkip ? 'skip duplicate same-SHA scheduled run' : 'run evidence lane'}`,
      `- Reason: ${result.reason}`,
      '',
    ].join('\n')
  );
}

function runDuplicateSuppressionCli() {
  const signalClass = process.env.CI_SIGNAL_CLASS ?? 'advisory';
  const duplicatePolicy = process.env.CI_DUPLICATE_POLICY ?? 'none';
  const workflowName = process.env.CI_WORKFLOW_NAME ?? process.env.GITHUB_WORKFLOW;
  const freshnessWindow = process.env.CI_DUPLICATE_FRESHNESS_WINDOW ?? '60m';
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const sha = process.env.GITHUB_SHA ?? '';
  const currentRunId = process.env.GITHUB_RUN_ID ?? '';
  const limit = Number(process.env.CI_DUPLICATE_RUN_LIST_LIMIT ?? '20');

  let runs = [];
  try {
    runs = eventName === 'schedule' ? ghRunList({ workflowName, limit }) : [];
  } catch (error) {
    const reason = `could not inspect prior scheduled runs: ${error.message}`;
    writeOutput('should_skip', 'false');
    writeOutput('reason', reason);
    writeSummary({
      signalClass,
      duplicatePolicy,
      result: { shouldSkip: false, reason },
    });
    return;
  }

  const result = resolveDuplicateSuppression({
    eventName,
    runs,
    sha,
    currentRunId,
    freshnessWindow,
  });

  writeOutput('should_skip', result.shouldSkip ? 'true' : 'false');
  writeOutput('reason', result.reason);
  writeOutput('matching_run_url', result.run?.url ?? '');
  writeSummary({ signalClass, duplicatePolicy, result });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const command = process.argv[2];

  if (command === 'duplicate-suppression') {
    runDuplicateSuppressionCli();
  } else {
    console.error('Usage: ci-signal-policy.mjs duplicate-suppression');
    process.exit(2);
  }
}
