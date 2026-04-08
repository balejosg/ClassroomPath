import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function buildGitHubApiHeaders({
  token,
  userAgent,
  accept = 'application/vnd.github+json',
}) {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    throw new Error('GitHub token cannot be empty');
  }

  const normalizedUserAgent = String(userAgent ?? '').trim();
  if (!normalizedUserAgent) {
    throw new Error('GitHub user-agent cannot be empty');
  }

  return {
    Accept: accept,
    Authorization: `Bearer ${normalizedToken}`,
    'User-Agent': normalizedUserAgent,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

export function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

export function serializeOutputs(outputMap) {
  return Object.entries(outputMap)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function normalizeWorkflowRuns(payload) {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.workflow_runs)
      ? payload.workflow_runs
      : [];
}

export function normalizeWorkflowRunId(run) {
  return run?.id ?? run?.databaseId ?? null;
}

export function normalizeWorkflowRunHeadSha(run) {
  return run?.head_sha ?? run?.headSha ?? null;
}

export function normalizeWorkflowRunUpdatedAt(run) {
  return run?.updated_at ?? run?.updatedAt ?? run?.created_at ?? run?.createdAt ?? null;
}

export function withNormalizedWorkflowRunId(run) {
  const runId = normalizeWorkflowRunId(run);
  if (!runId || run?.id) {
    return run;
  }

  return {
    ...run,
    id: runId,
  };
}

export function sortWorkflowRunsNewestFirst(runs) {
  return [...normalizeWorkflowRuns(runs)].sort((left, right) => {
    const leftTime = Date.parse(normalizeWorkflowRunUpdatedAt(left) ?? '');
    const rightTime = Date.parse(normalizeWorkflowRunUpdatedAt(right) ?? '');
    return rightTime - leftTime;
  });
}

export function normalizeArtifacts(payload) {
  return Array.isArray(payload?.artifacts) ? payload.artifacts : [];
}

export function resolveArtifactRunId(artifact) {
  return artifact?.workflow_run?.id ?? artifact?.workflowRun?.id ?? null;
}

export function resolveArtifactUpdatedAt(artifact) {
  return (
    artifact?.updated_at ??
    artifact?.updatedAt ??
    artifact?.created_at ??
    artifact?.createdAt ??
    null
  );
}

export function sortArtifactsNewestFirst(artifacts) {
  return [...normalizeArtifacts(artifacts)].sort((left, right) => {
    const leftTime = Date.parse(resolveArtifactUpdatedAt(left) ?? '');
    const rightTime = Date.parse(resolveArtifactUpdatedAt(right) ?? '');
    return rightTime - leftTime;
  });
}

export function isDirectExecution(importMetaUrl, argv1) {
  return Boolean(argv1) && importMetaUrl === new URL(`file://${argv1}`).href;
}
