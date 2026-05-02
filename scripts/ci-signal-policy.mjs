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

export function findFreshDeployEvidenceRun({
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
    const status = String(run.status ?? '');
    const conclusion = String(run.conclusion ?? '');
    const headBranch = String(run.headBranch ?? '');
    const workflowName = String(run.workflowName ?? run.name ?? '');

    return (
      runId !== String(currentRunId ?? '') &&
      workflowName === 'Deploy' &&
      run.event === 'push' &&
      headBranch.startsWith('v') &&
      run.headSha === sha &&
      (status === 'in_progress' || (status === 'completed' && conclusion === 'success')) &&
      Number.isFinite(updatedAt) &&
      updatedAt >= cutoffMs
    );
  });
}

export function resolveDuplicateSuppression({
  eventName,
  runs,
  deployRuns = [],
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
  const matchingDeployRun = findFreshDeployEvidenceRun({
    runs: deployRuns,
    sha,
    currentRunId,
    now,
    freshnessMs,
  });

  if (matchingDeployRun) {
    return {
      shouldSkip: true,
      reason: `deploy evidence run ${
        matchingDeployRun.databaseId ?? matchingDeployRun.id
      } is already covering ${sha}`,
      run: matchingDeployRun,
    };
  }

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

function ghRunList({ workflowName, limit, event = null, branch = null }) {
  const args = ['run', 'list', '--workflow', workflowName];
  if (event) args.push('--event', event);
  if (branch) args.push('--branch', branch);
  args.push(
    '--limit',
    String(limit),
    '--json',
    'databaseId,status,conclusion,headSha,headBranch,event,updatedAt,url,name,workflowName'
  );

  const stdout = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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
  let deployRuns = [];
  try {
    runs =
      eventName === 'schedule'
        ? ghRunList({ workflowName, limit, event: 'schedule', branch: 'main' })
        : [];
    deployRuns =
      eventName === 'schedule' ? ghRunList({ workflowName: 'Deploy', limit, event: 'push' }) : [];
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
    deployRuns,
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
