#!/usr/bin/env node

import {
  OPENPATH_CI_JOB_NAMES,
  OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
  classifyRequiredCheckWaitState,
  evaluateRequiredChecks,
  formatOpenPathRequiredChecksReport,
  parseRunIdFromUrl,
  resolveOpenPathRequiredChecks,
  selectLatestCheckRuns,
} from './lib/openpath-ci-checks.mjs';
import { buildGitHubApiHeaders, isDirectExecution } from './lib/github-actions.mjs';
import { rerunGitHubRunFailedJobs } from './lib/github-actions-artifacts.mjs';
import { gitOutput } from './lib/git-process.mjs';
import {
  classifyOpenPathPrereleaseRecovery,
  formatOpenPathPrereleaseRecoveryDecision,
  resolveOpenPathPrereleaseRecoveryChecks,
} from './lib/openpath-prerelease-recovery.mjs';

const DEFAULT_REQUIRED_CHECKS = ['CI Success'];

function usage() {
  console.log(`Usage: node scripts/openpath-required-checks.mjs [check|wait|report|recovery]

Verifies that the target OpenPath commit has the required GitHub check-runs in success state.
Report mode prints current required-check state and exits 0 unless the GitHub API fails.

Environment variables:
  OPENPATH_SHA              Commit SHA to verify. Defaults to the local upstream/openpath submodule SHA.
  OPENPATH_BASE_SHA         Optional previous OpenPath SHA used to derive risk-aware required checks.
  OPENPATH_REPO             GitHub repo in owner/name form. Default: balejosg/openpath
  OPENPATH_REQUIRED_CHECKS  Comma-separated explicit override of required check names.
  OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS   Wait mode timeout. Default: 600.
  OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS  Wait mode polling interval. Default: 10.
  OPENPATH_REQUIRED_CHECKS_FAIL_FAST         Wait mode terminal failure behavior. Default: true.
  OPENPATH_PRERELEASE_RECOVERY_MODE          Advisory by default. Set to rerun-failed-once to rerun one failed prerelease APT job.
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

export function parseRecoveryMode(env = process.env) {
  const rawValue = env.OPENPATH_PRERELEASE_RECOVERY_MODE?.trim();

  if (!rawValue) {
    return 'advisory';
  }

  if (rawValue === 'advisory' || rawValue === 'rerun-failed-once') {
    return rawValue;
  }

  throw new Error('OPENPATH_PRERELEASE_RECOVERY_MODE must be advisory or rerun-failed-once');
}

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

async function buildWorkflowJobsByRunId({ repo, checkRuns, requiredChecks, token }) {
  const latestByName = selectLatestCheckRuns(checkRuns);
  const runIds = new Set();

  if (requiredChecks.includes('CI Success')) {
    const ciRunId = selectLatestOpenPathCiRunId(checkRuns);
    if (ciRunId) {
      runIds.add(ciRunId);
    }
  }

  for (const checkName of requiredChecks) {
    const checkRun = latestByName.get(checkName);
    const runId = parseRunIdFromUrl(checkRun?.details_url ?? checkRun?.html_url ?? '');

    if (runId) {
      runIds.add(runId);
    }
  }

  const jobsByRunId = Object.fromEntries(
    await Promise.all(
      [...runIds].map(async (runId) => [runId, await fetchWorkflowRunJobs({ repo, runId, token })])
    )
  );

  return jobsByRunId;
}

function printRequiredChecksReport({ context, evaluation }) {
  const report = formatOpenPathRequiredChecksReport({
    repo: context.repo,
    sha: context.sha,
    requiredChecks: context.requiredChecks,
    checkRuns: evaluation.checkRuns,
    evaluation: evaluation.result,
    requiredCheckResolution: context.requiredCheckResolution,
  });
  console.log(report);
}

function printFailureSummary({ context, result, evaluation }) {
  if (evaluation) {
    console.error(
      formatOpenPathRequiredChecksReport({
        repo: context.repo,
        sha: context.sha,
        requiredChecks: context.requiredChecks,
        checkRuns: evaluation.checkRuns,
        evaluation: evaluation.result,
        requiredCheckResolution: context.requiredCheckResolution,
      })
    );
    console.error('');
  }

  const { repo, sha } = context;
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
  const workflowJobsByRunId = await buildWorkflowJobsByRunId({
    repo,
    checkRuns,
    requiredChecks: requiredChecks.includes(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK)
      ? resolveOpenPathPrereleaseRecoveryChecks(requiredChecks)
      : requiredChecks,
    token,
  });
  const workflowJobs = Object.values(workflowJobsByRunId).flatMap((jobs) => jobs ?? []);
  const result = evaluateRequiredChecks({ checkRuns, requiredChecks, workflowJobs });
  const recoveryDecision = requiredChecks.includes(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK)
    ? classifyOpenPathPrereleaseRecovery({
        openPathSha: sha,
        requiredChecks,
        checkRuns,
        workflowRuns: Object.keys(workflowJobsByRunId).map((runId) => ({
          id: runId,
          headSha: sha,
        })),
        workflowJobsByRunId,
        alreadyReran: false,
        allowRerun: false,
        repo,
      })
    : null;

  return {
    checkRuns,
    workflowJobs,
    workflowJobsByRunId,
    result,
    recoveryDecision,
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
  let alreadyReranPrerelease = false;

  while (true) {
    const evaluation = await evaluateOpenPathRequiredChecks(context);
    const { checkRuns, workflowJobs, result, workflowJobsByRunId } = evaluation;
    const waitState = classifyRequiredCheckWaitState({
      checkRuns,
      requiredChecks: context.requiredChecks,
      workflowJobs,
    });
    const recoveryDecision = context.requiredChecks.includes(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK)
      ? classifyOpenPathPrereleaseRecovery({
          openPathSha: context.sha,
          requiredChecks: context.requiredChecks,
          checkRuns,
          workflowRuns: Object.keys(workflowJobsByRunId).map((runId) => ({
            id: runId,
            headSha: context.sha,
          })),
          workflowJobsByRunId,
          alreadyReran: alreadyReranPrerelease,
          allowRerun: parseRecoveryMode() === 'rerun-failed-once',
          repo: context.repo,
        })
      : null;
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);

    if (recoveryDecision?.state === 'ready' || waitState.kind === 'passed') {
      printSuccessSummary(context);
      return true;
    }

    if (recoveryDecision?.state === 'rerun_requested' && recoveryDecision.runId) {
      console.error(
        `${formatOpenPathPrereleaseRecoveryDecision(recoveryDecision)}; rerunning failed jobs once.`
      );
      rerunGitHubRunFailedJobs({
        repo: context.repo,
        runId: recoveryDecision.runId,
        cwd: process.cwd(),
      });
      alreadyReranPrerelease = true;
      attempt += 1;
      const remainingMilliseconds = Math.max(0, timeoutMilliseconds - (Date.now() - startedAt));
      await sleep(Math.min(intervalMilliseconds, remainingMilliseconds));
      continue;
    }

    if (recoveryDecision?.state === 'rerun_available' || recoveryDecision?.state === 'failed') {
      printFailureSummary({ context, result, evaluation });
      console.error(formatOpenPathPrereleaseRecoveryDecision(recoveryDecision));
      return false;
    }

    if (recoveryDecision?.state === 'waiting') {
      if (Date.now() - startedAt >= timeoutMilliseconds) {
        printFailureSummary({ context, result, evaluation });
        console.error(
          `Timed out after ${elapsedSeconds}s waiting for OpenPath required checks for ${context.repo}@${context.sha}: ${formatOpenPathPrereleaseRecoveryDecision(
            recoveryDecision
          )}`
        );
        return false;
      }

      console.log(
        `Waiting for OpenPath required checks for ${context.repo}@${context.sha} (attempt ${attempt}, elapsed ${elapsedSeconds}s): ${formatOpenPathPrereleaseRecoveryDecision(
          recoveryDecision
        )}`
      );

      attempt += 1;
      const remainingMilliseconds = Math.max(0, timeoutMilliseconds - (Date.now() - startedAt));
      await sleep(Math.min(intervalMilliseconds, remainingMilliseconds));
      continue;
    }

    if (waitState.kind === 'terminal_failure' && options.failFast) {
      printFailureSummary({ context, result, evaluation });
      console.error(
        recoveryDecision?.state === 'blocked'
          ? `${formatOpenPathPrereleaseRecoveryDecision(recoveryDecision)} after ${elapsedSeconds}s`
          : `OpenPath required checks reached terminal failure after ${elapsedSeconds}s: ${summarizeWaitState(
              waitState
            )}`
      );
      return false;
    }

    if (Date.now() - startedAt >= timeoutMilliseconds) {
      printFailureSummary({ context, result, evaluation });
      console.error(
        `Timed out after ${elapsedSeconds}s waiting for OpenPath required checks for ${context.repo}@${context.sha}: ${
          recoveryDecision?.state === 'waiting'
            ? formatOpenPathPrereleaseRecoveryDecision(recoveryDecision)
            : summarizeWaitState(waitState)
        }`
      );
      return false;
    }

    console.log(
      `Waiting for OpenPath required checks for ${context.repo}@${context.sha} (attempt ${attempt}, elapsed ${elapsedSeconds}s): ${
        recoveryDecision?.state === 'waiting' || recoveryDecision?.state === 'rerun_requested'
          ? formatOpenPathPrereleaseRecoveryDecision(recoveryDecision)
          : summarizeWaitState(waitState)
      }`
    );

    attempt += 1;
    const remainingMilliseconds = Math.max(0, timeoutMilliseconds - (Date.now() - startedAt));
    await sleep(Math.min(intervalMilliseconds, remainingMilliseconds));
  }
}

export async function runOpenPathRequiredChecksCommand(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const command = argv[2] ?? 'check';
  if (command !== 'check' && command !== 'wait' && command !== 'report' && command !== 'recovery') {
    throw new Error(`Unknown command: ${command}`);
  }

  const context = resolveExecutionContext();

  if (command === 'recovery') {
    const recoveryContext = {
      ...context,
      requiredChecks: resolveOpenPathPrereleaseRecoveryChecks([
        ...context.requiredChecks,
        OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
      ]),
    };
    const { checkRuns, workflowJobsByRunId } =
      await evaluateOpenPathRequiredChecks(recoveryContext);
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: recoveryContext.sha,
      requiredChecks: recoveryContext.requiredChecks,
      checkRuns,
      workflowRuns: Object.keys(workflowJobsByRunId).map((runId) => ({
        id: runId,
        headSha: recoveryContext.sha,
      })),
      workflowJobsByRunId,
      alreadyReran: false,
      allowRerun: parseRecoveryMode() === 'rerun-failed-once',
      repo: recoveryContext.repo,
    });
    console.log(JSON.stringify(decision));
    return;
  }

  if (command === 'report') {
    const evaluation = await evaluateOpenPathRequiredChecks(context);
    printRequiredChecksReport({ context, evaluation });
    return;
  }

  if (command === 'wait') {
    const ok = await waitForRequiredChecks(context, parseWaitOptions());
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  const evaluation = await evaluateOpenPathRequiredChecks(context);
  const { result, recoveryDecision } = evaluation;

  if (!result.ok) {
    printFailureSummary({ context, result, evaluation });
    if (recoveryDecision && recoveryDecision.state !== 'waiting') {
      console.error(formatOpenPathPrereleaseRecoveryDecision(recoveryDecision));
    }
    process.exitCode = 1;
    return;
  }

  printSuccessSummary(context);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await runOpenPathRequiredChecksCommand();
}
