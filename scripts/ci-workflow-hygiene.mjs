#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const DURATION_PATTERN = /^(\d+)(m|h|d)$/;
const STALE_STATUSES = new Set(['queued', 'in_progress']);
const SAFE_SIGNAL_CLASSES = new Set(['maintenance', 'post-release health']);
const RELEASE_BLOCKING_WORKFLOWS = new Set([
  'Deploy',
  'Release Candidate Images',
  'CI',
  'Firefox Release Assets',
  'Verify Trailers',
  'Promote Current Staging Candidate',
]);

export const DEFAULT_ELIGIBLE_WORKFLOW_POLICIES = [
  {
    workflowName: 'Production Client Update Canary',
    workflowFile: 'production-client-update-canary.yml',
    signalClass: 'post-release health',
    releaseBlocking: false,
  },
  {
    workflowName: 'Sync OpenPath',
    workflowFile: 'sync-openpath.yml',
    signalClass: 'maintenance',
    releaseBlocking: false,
  },
];

export function parseHygieneDuration(value) {
  const match = String(value ?? '')
    .trim()
    .match(DURATION_PATTERN);
  if (!match) {
    throw new Error(`Unsupported hygiene duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

function runId(run) {
  return String(run.databaseId ?? run.id ?? '').trim();
}

function workflowNameForRun(run) {
  return String(run.workflowName ?? run.workflow_name ?? run.name ?? '').trim();
}

function timestampForRun(run) {
  return String(run.updatedAt ?? run.createdAt ?? '').trim();
}

function policyByWorkflowName(workflowPolicies) {
  return new Map(workflowPolicies.map((policy) => [policy.workflowName, policy]));
}

function isReleaseTagRun(run) {
  return String(run.headBranch ?? '').startsWith('v');
}

function normalizeStaleRun({ run, policy, now, timestampMs, action }) {
  const ageMs = Math.max(0, now.getTime() - timestampMs);

  return {
    id: run.id ?? null,
    databaseId: run.databaseId ?? run.id ?? null,
    workflowName: workflowNameForRun(run),
    workflowFile: policy.workflowFile,
    signalClass: policy.signalClass,
    event: run.event ?? '',
    status: run.status ?? '',
    conclusion: run.conclusion ?? '',
    headSha: run.headSha ?? '',
    headBranch: run.headBranch ?? '',
    createdAt: run.createdAt ?? '',
    updatedAt: run.updatedAt ?? '',
    url: run.url ?? '',
    ageMs,
    action,
    reason: `stale scheduled ${run.status} run older than hygiene threshold`,
  };
}

export function findStaleScheduledMaintenanceRuns({
  runs,
  now = new Date(),
  staleAfterMs,
  currentRunId = '',
  workflowPolicies = DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
}) {
  const cutoffMs = now.getTime() - staleAfterMs;
  const policies = policyByWorkflowName(workflowPolicies);

  return runs.flatMap((run) => {
    const workflowName = workflowNameForRun(run);
    const policy = policies.get(workflowName);
    const timestampMs = Date.parse(timestampForRun(run));

    if (!policy) return [];
    if (policy.releaseBlocking) return [];
    if (!SAFE_SIGNAL_CLASSES.has(policy.signalClass)) return [];
    if (RELEASE_BLOCKING_WORKFLOWS.has(workflowName)) return [];
    if (runId(run) === String(currentRunId ?? '')) return [];
    if (run.event !== 'schedule') return [];
    if (!STALE_STATUSES.has(String(run.status ?? ''))) return [];
    if (isReleaseTagRun(run)) return [];
    if (!Number.isFinite(timestampMs) || timestampMs > cutoffMs) return [];

    return [normalizeStaleRun({ run, policy, now, timestampMs, action: 'report-only' })];
  });
}

function ghRunList({ workflowName, status, limit }) {
  const args = [
    'run',
    'list',
    '--workflow',
    workflowName,
    '--event',
    'schedule',
    '--status',
    status,
    '--limit',
    String(limit),
    '--json',
    'databaseId,status,conclusion,headSha,headBranch,event,createdAt,updatedAt,url,name,workflowName',
  ];
  const stdout = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  return JSON.parse(stdout);
}

function ghCancelRun(runIdValue) {
  execFileSync('gh', ['run', 'cancel', String(runIdValue)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function dedupeRuns(runs) {
  const seen = new Set();
  const deduped = [];

  for (const run of runs) {
    const key = runId(run);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(run);
  }

  return deduped;
}

async function listScheduledRunsWithGh({ workflowPolicies, limit }) {
  const runs = [];

  for (const policy of workflowPolicies) {
    for (const status of STALE_STATUSES) {
      runs.push(...ghRunList({ workflowName: policy.workflowName, status, limit }));
    }
  }

  return dedupeRuns(runs);
}

export async function runWorkflowHygiene({
  cancel = false,
  confirmCancel = false,
  staleAfter = '90m',
  now = new Date(),
  currentRunId = '',
  workflowPolicies = DEFAULT_ELIGIBLE_WORKFLOW_POLICIES,
  listRuns = listScheduledRunsWithGh,
  cancelRun = ghCancelRun,
  limit = 50,
} = {}) {
  const staleAfterMs = parseHygieneDuration(staleAfter);
  const cancelEnabled = Boolean(cancel && confirmCancel);
  const runs = await listRuns({ workflowPolicies, limit });
  const staleRuns = findStaleScheduledMaintenanceRuns({
    runs,
    now,
    staleAfterMs,
    currentRunId,
    workflowPolicies,
  });

  if (cancelEnabled) {
    for (const run of staleRuns) {
      await cancelRun(run.databaseId ?? run.id);
      run.action = 'cancelled';
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: cancelEnabled ? 'cancel' : 'dry-run',
    cancelEnabled,
    staleAfter,
    staleAfterMs,
    workflowPolicies,
    staleRuns,
    staleCount: staleRuns.length,
    cancelledCount: cancelEnabled ? staleRuns.length : 0,
    safety: {
      eligibleEvents: ['schedule'],
      eligibleStatuses: Array.from(STALE_STATUSES),
      eligibleSignalClasses: Array.from(SAFE_SIGNAL_CLASSES),
      releaseBlockingWorkflowsExcluded: Array.from(RELEASE_BLOCKING_WORKFLOWS),
      cancellationRequires: ['--cancel', 'CI_WORKFLOW_HYGIENE_CONFIRM_CANCEL=true'],
    },
  };
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${name}=${value}`);
    return;
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function writeSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const rows =
    report.staleRuns.length > 0
      ? report.staleRuns
          .map(
            (run) =>
              `| ${run.workflowName} | ${run.databaseId} | ${run.status} | ${run.event} | ${run.action} | ${run.url || 'n/a'} |`
          )
          .join('\n')
      : '| n/a | n/a | n/a | n/a | n/a | n/a |';

  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### CI workflow hygiene',
      '',
      `- Mode: ${report.mode}`,
      `- Stale threshold: ${report.staleAfter}`,
      `- Stale scheduled runs: ${report.staleCount}`,
      `- Cancelled runs: ${report.cancelledCount}`,
      `- Release-blocking workflows excluded: ${report.safety.releaseBlockingWorkflowsExcluded.join(', ')}`,
      '',
      '| Workflow | Run | Status | Event | Action | URL |',
      '| --- | --- | --- | --- | --- | --- |',
      rows,
      '',
    ].join('\n')
  );
}

function writeEvidence(report) {
  const path = process.env.CI_WORKFLOW_HYGIENE_EVIDENCE_PATH ?? 'ci-workflow-hygiene-report.json';
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

function parseWorkflowPoliciesFromEnv() {
  const configuredNames = String(process.env.CI_WORKFLOW_HYGIENE_WORKFLOWS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (configuredNames.length === 0) {
    return DEFAULT_ELIGIBLE_WORKFLOW_POLICIES;
  }

  const policies = policyByWorkflowName(DEFAULT_ELIGIBLE_WORKFLOW_POLICIES);
  return configuredNames.map((workflowName) => {
    const policy = policies.get(workflowName);
    if (!policy) {
      throw new Error(`Unsupported hygiene workflow: ${workflowName}`);
    }
    return policy;
  });
}

async function runReportStaleRunsCli(argv) {
  const cancel = argv.includes('--cancel');
  const confirmCancel = process.env.CI_WORKFLOW_HYGIENE_CONFIRM_CANCEL === 'true';
  const staleAfterIndex = argv.indexOf('--stale-after');
  const staleAfter =
    staleAfterIndex >= 0
      ? argv[staleAfterIndex + 1]
      : (process.env.CI_WORKFLOW_HYGIENE_STALE_AFTER ?? '90m');
  const limit = Number(process.env.CI_WORKFLOW_HYGIENE_RUN_LIMIT ?? '50');
  const workflowPolicies = parseWorkflowPoliciesFromEnv();

  let report;
  try {
    report = await runWorkflowHygiene({
      cancel,
      confirmCancel,
      staleAfter,
      currentRunId: process.env.GITHUB_RUN_ID ?? '',
      workflowPolicies,
      limit,
    });
  } catch (error) {
    report = {
      generatedAt: new Date().toISOString(),
      mode: 'dry-run',
      cancelEnabled: false,
      staleAfter,
      workflowPolicies,
      staleRuns: [],
      staleCount: 0,
      cancelledCount: 0,
      lookupError: error.message,
      safety: {
        eligibleEvents: ['schedule'],
        eligibleStatuses: Array.from(STALE_STATUSES),
        eligibleSignalClasses: Array.from(SAFE_SIGNAL_CLASSES),
        releaseBlockingWorkflowsExcluded: Array.from(RELEASE_BLOCKING_WORKFLOWS),
        cancellationRequires: ['--cancel', 'CI_WORKFLOW_HYGIENE_CONFIRM_CANCEL=true'],
      },
    };
  }

  const evidencePath = writeEvidence(report);
  writeSummary(report);
  writeOutput('mode', report.mode);
  writeOutput('stale_count', String(report.staleCount));
  writeOutput('cancelled_count', String(report.cancelledCount));
  writeOutput('evidence_path', evidencePath);

  if (report.lookupError) {
    console.log(`CI workflow hygiene lookup failed in report-only mode: ${report.lookupError}`);
  } else {
    console.log(
      `CI workflow hygiene ${report.mode}: ${report.staleCount} stale scheduled run(s), ${report.cancelledCount} cancelled.`
    );
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const command = process.argv[2];

  if (command === 'report-stale-runs') {
    runReportStaleRunsCli(process.argv.slice(3)).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  } else {
    console.error('Usage: ci-workflow-hygiene.mjs report-stale-runs [--cancel]');
    process.exit(2);
  }
}
