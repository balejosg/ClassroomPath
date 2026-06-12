/**
 * Attempts to recover a blocked OpenPath pre-release by re-running failed required checks on the PR.
 *
 * Invoked by: Imported by release orchestration scripts.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN.
 */
import { normalizeWorkflowRunId } from './github-actions.mjs';
import {
  OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
  classifyRequiredCheckWaitState,
  parseRunIdFromUrl,
  selectLatestCheckRuns,
} from './openpath-ci-checks.mjs';

export const OPENPATH_PRERELEASE_RECOVERY_SUPPORTING_CHECKS = [
  'CI Success',
  'E2E Summary',
  'Installer Contracts Success',
];

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildWorkflowRunUrl({ repo, runId }) {
  if (!repo || !runId) {
    return '';
  }

  return `https://github.com/${repo}/actions/runs/${runId}`;
}

function findFailedStep(jobs = []) {
  for (const job of jobs ?? []) {
    for (const step of job?.steps ?? []) {
      if (step?.conclusion === 'failure') {
        return {
          jobName: String(job.name ?? '').trim(),
          stepName: String(step.name ?? '').trim(),
        };
      }
    }
  }

  const failedJob = (jobs ?? []).find((job) => job?.conclusion === 'failure');
  if (!failedJob) {
    return null;
  }

  return {
    jobName: String(failedJob.name ?? '').trim(),
    stepName: '',
  };
}

function selectPrereleaseWorkflowRun({ workflowRuns = [], runId, openPathSha }) {
  const normalizedRunId = String(runId ?? '').trim();
  const normalizedSha = String(openPathSha ?? '').trim();

  if (normalizedRunId) {
    const matchingRun = workflowRuns.find(
      (candidate) => String(normalizeWorkflowRunId(candidate) ?? '').trim() === normalizedRunId
    );
    if (matchingRun) {
      return matchingRun;
    }
  }

  if (normalizedSha) {
    const matchingShaRun = workflowRuns.find(
      (candidate) =>
        String(candidate?.head_sha ?? candidate?.headSha ?? '').trim() === normalizedSha
    );
    if (matchingShaRun) {
      return matchingShaRun;
    }
  }

  return workflowRuns[0] ?? null;
}

export function resolveOpenPathPrereleaseRecoveryChecks(requiredChecks = []) {
  const normalizedRequiredChecks = uniqueValues(requiredChecks);

  if (!normalizedRequiredChecks.includes(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK)) {
    return normalizedRequiredChecks;
  }

  return uniqueValues([
    ...OPENPATH_PRERELEASE_RECOVERY_SUPPORTING_CHECKS,
    ...normalizedRequiredChecks,
  ]);
}

export function classifyOpenPathPrereleaseRecovery({
  openPathSha,
  requiredChecks,
  checkRuns,
  workflowRuns = [],
  workflowJobsByRunId = {},
  alreadyReran = false,
  allowRerun = false,
  repo = 'balejosg/openpath',
}) {
  const normalizedRequiredChecks = resolveOpenPathPrereleaseRecoveryChecks(requiredChecks);
  const latestByName = selectLatestCheckRuns(checkRuns);
  const allWorkflowJobs = Object.values(workflowJobsByRunId).flatMap((jobs) => jobs ?? []);
  const supportingRequiredChecks = normalizedRequiredChecks.filter(
    (checkName) => checkName !== OPENPATH_PRERELEASE_APT_REQUIRED_CHECK
  );
  const fullWaitState = classifyRequiredCheckWaitState({
    checkRuns,
    requiredChecks: normalizedRequiredChecks,
    workflowJobs: allWorkflowJobs,
  });
  const supportingWaitState = classifyRequiredCheckWaitState({
    checkRuns,
    requiredChecks: supportingRequiredChecks,
    workflowJobs: allWorkflowJobs,
  });
  const aptCheckRun = latestByName.get(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK) ?? null;
  const aptRunId =
    parseRunIdFromUrl(aptCheckRun?.details_url ?? aptCheckRun?.html_url ?? '') ??
    String(
      normalizeWorkflowRunId(selectPrereleaseWorkflowRun({ workflowRuns, openPathSha })) ?? ''
    ).trim();
  const workflowRun = selectPrereleaseWorkflowRun({ workflowRuns, runId: aptRunId, openPathSha });
  const workflowJobs = workflowJobsByRunId[String(aptRunId)] ?? [];
  const failedStep = findFailedStep(workflowJobs);
  const runUrl =
    String(aptCheckRun?.details_url ?? aptCheckRun?.html_url ?? '').trim() ||
    buildWorkflowRunUrl({ repo, runId: aptRunId });

  let state = 'waiting';

  if (fullWaitState.kind === 'passed') {
    state = 'ready';
  } else if (supportingWaitState.kind === 'terminal_failure') {
    state = 'blocked';
  } else if (supportingWaitState.kind === 'pending') {
    state = 'waiting';
  } else if (aptCheckRun?.status === 'completed' && aptCheckRun?.conclusion !== 'success') {
    if (alreadyReran) {
      state = 'failed';
    } else if (allowRerun) {
      state = 'rerun_requested';
    } else {
      state = 'rerun_available';
    }
  } else if (fullWaitState.kind === 'pending') {
    state = 'waiting';
  }

  return {
    state,
    openPathSha: String(openPathSha ?? '').trim(),
    workflowName:
      String(
        workflowRun?.name ?? aptCheckRun?.name ?? OPENPATH_PRERELEASE_APT_REQUIRED_CHECK
      ).trim() || OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
    workflowStatus: String(workflowRun?.status ?? aptCheckRun?.status ?? '').trim(),
    workflowConclusion: String(workflowRun?.conclusion ?? aptCheckRun?.conclusion ?? '').trim(),
    requiredChecks: normalizedRequiredChecks,
    pendingChecks: fullWaitState.pending,
    blockingChecks: supportingWaitState.terminalFailures.map((failure) => failure.name),
    runId: String(aptRunId ?? '').trim(),
    runUrl,
    failedJob: failedStep?.jobName ?? '',
    failedStep: failedStep?.stepName ?? '',
    rerunCommand: aptRunId ? `gh run rerun ${aptRunId} --repo ${repo} --failed` : '',
  };
}

export function formatOpenPathPrereleaseRecoveryDecision(decision = {}) {
  const details = [`state=${decision.state ?? 'unknown'}`];

  if (decision.runUrl) {
    details.push(`run_url=${decision.runUrl}`);
  }

  if (decision.workflowName) {
    details.push(`workflow=${decision.workflowName}`);
  }

  if (decision.workflowStatus) {
    details.push(`workflow_status=${decision.workflowStatus}`);
  }

  if (decision.workflowConclusion) {
    details.push(`workflow_conclusion=${decision.workflowConclusion}`);
  }

  if (decision.failedJob) {
    details.push(`failed_job=${decision.failedJob}`);
  }

  if (decision.failedStep) {
    details.push(`failed_step=${decision.failedStep}`);
  }

  if (decision.pendingChecks?.length > 0) {
    details.push(`pending_checks=${decision.pendingChecks.join(', ')}`);
  }

  if (decision.blockingChecks?.length > 0) {
    details.push(`blocking_checks=${decision.blockingChecks.join(', ')}`);
  }

  if (decision.rerunCommand) {
    details.push(`rerun_command="${decision.rerunCommand}"`);
  }

  return `OpenPath prerelease recovery (${details.join('; ')})`;
}
