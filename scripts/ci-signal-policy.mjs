#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

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
  targetEnvironment = null,
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
      (!targetEnvironment ||
        !run.targetEnvironment ||
        String(run.targetEnvironment) === String(targetEnvironment)) &&
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
  targetEnvironment = null,
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
      (!targetEnvironment ||
        !run.targetEnvironment ||
        String(run.targetEnvironment) === String(targetEnvironment)) &&
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
  targetEnvironment = null,
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
    targetEnvironment,
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
    targetEnvironment,
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

function matchingRunTimestamp(run) {
  return String(run?.updatedAt ?? run?.createdAt ?? '').trim();
}

export function buildCiSignalPolicyEvidence({
  eventName,
  sha,
  currentRunId,
  targetEnvironment,
  result,
}) {
  const matchingRunUrl = result.run?.url ?? '';
  const lastLiveTestedAt = result.shouldSkip ? matchingRunTimestamp(result.run) : '';
  const evidenceState = result.shouldSkip
    ? 'skipped-duplicate'
    : eventName === 'workflow_dispatch'
      ? 'manual-dispatch-required'
      : 'live-tested';
  const evidenceLevel = result.shouldSkip ? 'skipped' : 'live';

  return {
    generatedAt: new Date().toISOString(),
    evidenceState,
    evidenceLevel,
    eventName,
    targetEnvironment,
    workflowRunId: String(currentRunId ?? ''),
    workflowSha: String(sha ?? ''),
    shouldSkip: result.shouldSkip,
    reason: result.reason,
    matching_run_url: matchingRunUrl,
    last_live_tested_at: lastLiveTestedAt,
  };
}

function writeEvidenceArtifact(evidence) {
  const path = process.env.CI_SIGNAL_POLICY_EVIDENCE_PATH ?? 'ci-signal-policy-evidence.json';
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

function writeSummary({
  signalClass,
  duplicatePolicy,
  targetEnvironment,
  releaseEvidenceAffected,
  nextAction,
  result,
  evidence,
}) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### CI signal policy',
      '',
      `- Signal class: ${signalClass}`,
      `- Target environment: ${targetEnvironment}`,
      `- Duplicate policy: ${duplicatePolicy}`,
      `- Decision: ${result.shouldSkip ? 'skip duplicate same-SHA scheduled run' : 'run evidence lane'}`,
      `- Evidence state: ${evidence.evidenceState}`,
      `- Evidence level: ${evidence.evidenceLevel}`,
      `- Reason: ${result.reason}`,
      `- Matching run URL: ${evidence.matching_run_url || 'n/a'}`,
      `- Last live tested at: ${evidence.last_live_tested_at || 'n/a'}`,
      `- Release evidence affected: ${releaseEvidenceAffected}`,
      `- Next action: ${nextAction}`,
      '',
    ].join('\n')
  );
}

function runDuplicateSuppressionCli() {
  const signalClass = process.env.CI_SIGNAL_CLASS ?? 'advisory';
  const duplicatePolicy = process.env.CI_DUPLICATE_POLICY ?? 'none';
  const workflowName = process.env.CI_WORKFLOW_NAME ?? process.env.GITHUB_WORKFLOW;
  const targetEnvironment = process.env.CI_TARGET_ENVIRONMENT ?? 'unknown';
  const releaseEvidenceAffected = process.env.CI_RELEASE_EVIDENCE_AFFECTED ?? 'no';
  const nextAction =
    process.env.CI_NEXT_ACTION ??
    'Review this run only if the evidence lane executes or the policy lookup fails.';
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
    const result = { shouldSkip: false, reason };
    const evidence = buildCiSignalPolicyEvidence({
      eventName,
      sha,
      currentRunId,
      targetEnvironment,
      result,
    });
    const evidencePath = writeEvidenceArtifact(evidence);
    writeOutput('should_skip', 'false');
    writeOutput('reason', reason);
    writeOutput('matching_run_url', '');
    writeOutput('last_live_tested_at', '');
    writeOutput('evidence_state', evidence.evidenceState);
    writeOutput('evidenceLevel', evidence.evidenceLevel);
    writeOutput('evidence_path', evidencePath);
    writeSummary({
      signalClass,
      duplicatePolicy,
      targetEnvironment,
      releaseEvidenceAffected,
      nextAction,
      result,
      evidence,
    });
    return;
  }

  const result = resolveDuplicateSuppression({
    eventName,
    runs: runs.map((run) => ({ ...run, targetEnvironment })),
    deployRuns: deployRuns.map((run) => ({ ...run, targetEnvironment: 'production' })),
    sha,
    currentRunId,
    targetEnvironment,
    freshnessWindow,
  });
  const evidence = buildCiSignalPolicyEvidence({
    eventName,
    sha,
    currentRunId,
    targetEnvironment,
    result,
  });
  const evidencePath = writeEvidenceArtifact(evidence);

  writeOutput('should_skip', result.shouldSkip ? 'true' : 'false');
  writeOutput('reason', result.reason);
  writeOutput('matching_run_url', evidence.matching_run_url);
  writeOutput('last_live_tested_at', evidence.last_live_tested_at);
  writeOutput('evidence_state', evidence.evidenceState);
  writeOutput('evidenceLevel', evidence.evidenceLevel);
  writeOutput('evidence_path', evidencePath);
  writeSummary({
    signalClass,
    duplicatePolicy,
    targetEnvironment,
    releaseEvidenceAffected,
    nextAction,
    result,
    evidence,
  });
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
