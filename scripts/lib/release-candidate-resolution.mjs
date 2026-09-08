import { viewGitHubWorkflowRun } from './github-actions-artifacts.mjs';
import { resolveExactReleaseCandidateBundle } from './release-candidate-bundle.mjs';

const SHA40_PATTERN = /^[0-9a-f]{40}$/;

/** @typedef {Record<string, unknown>} JsonObject */

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireNonEmptyString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required to resolve an exact release candidate`);
  }
  return normalized;
}

export function normalizeExplicitRcRunId(value, label = 'RC run id') {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a numeric GitHub run id`);
  }
  return normalized;
}

function normalizeSha40(value, label = 'ClassroomPath SHA') {
  const normalized = String(value ?? '').trim();
  if (!SHA40_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a full lowercase 40-character SHA`);
  }
  return normalized;
}

function runIdOf(run) {
  return String(run?.databaseId ?? run?.runId ?? run?.id ?? '').trim();
}

function headShaOf(run) {
  return String(run?.headSha ?? run?.head_sha ?? '').trim();
}

function workflowNameOf(run) {
  return String(run?.workflowName ?? run?.workflow_name ?? run?.name ?? '')
    .trim()
    .toLowerCase();
}

export function assertSuccessfulReleaseCandidateRun(run, expectedRunId) {
  const actualRunId = runIdOf(run);
  if (!actualRunId || actualRunId !== expectedRunId) {
    throw new Error(
      `Release candidate run id does not match the explicit RC run id: ${actualRunId || 'missing'} != ${expectedRunId}`
    );
  }

  const event = String(run?.event ?? '')
    .trim()
    .toLowerCase();
  if (event && event !== 'push') {
    throw new Error(`Release candidate run must be a push workflow run, received ${event}`);
  }

  const status = String(run?.status ?? '')
    .trim()
    .toLowerCase();
  const conclusion = String(run?.conclusion ?? '')
    .trim()
    .toLowerCase();
  if (status !== 'completed' || conclusion !== 'success') {
    throw new Error(
      `Release candidate run must be completed successfully, received status=${status || 'missing'} conclusion=${conclusion || 'missing'}`
    );
  }

  const workflowName = workflowNameOf(run);
  if (
    workflowName &&
    !workflowName.includes('release-candidate') &&
    !workflowName.includes('release candidate')
  ) {
    throw new Error(`Explicit run is not the release-candidate workflow: ${workflowName}`);
  }

  return run;
}

/**
 * Resolve exactly one successful release-candidate run selected by its immutable run id.
 * The run's head SHA is the only candidate SHA accepted by the exact bundle resolver.
 *
 * @param {{repository?: string; rcRunId?: string|number; run?: JsonObject; resolveBundle?: (options: JsonObject) => JsonObject; viewRun?: (options: {repo: string; runId: string; cwd?: string}) => JsonObject; cwd?: string; [key: string]: unknown}} [params]
 * @returns {JsonObject}
 */
export function resolveExplicitReleaseCandidateBundle({
  repository,
  rcRunId,
  run,
  resolveBundle = resolveExactReleaseCandidateBundle,
  viewRun = viewGitHubWorkflowRun,
  cwd,
  ...options
} = {}) {
  const requestedRunId = normalizeExplicitRcRunId(rcRunId);
  const repo = requireNonEmptyString(repository, 'repository');
  const selectedRun = run ?? viewRun({ repo, runId: requestedRunId, cwd });
  assertSuccessfulReleaseCandidateRun(selectedRun, requestedRunId);

  const classroomPathSha = normalizeSha40(
    headShaOf(selectedRun),
    'Release candidate ClassroomPath SHA'
  );
  const resolved = resolveBundle({
    ...options,
    repository: repo,
    classroomPathSha,
    runId: requestedRunId,
    run: selectedRun,
    cwd,
  });

  if (String(resolved?.runId ?? '').trim() !== requestedRunId) {
    throw new Error(
      `Resolved Release Bundle run id does not match the explicit RC run id: ${resolved?.runId ?? 'missing'} != ${requestedRunId}`
    );
  }
  if (String(resolved?.headSha ?? '').trim() !== classroomPathSha) {
    throw new Error(
      `Resolved Release Bundle ClassroomPath SHA does not match the explicit RC run SHA: ${resolved?.headSha ?? 'missing'} != ${classroomPathSha}`
    );
  }

  return {
    ...resolved,
    rcRunId: requestedRunId,
    classroomPathSha,
  };
}
