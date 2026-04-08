import { execFileSync } from 'node:child_process';

import {
  normalizeWorkflowRunHeadSha,
  sortWorkflowRunsNewestFirst,
  withNormalizedWorkflowRunId,
} from './github-actions.mjs';

function normalizeOwner(owner) {
  const normalized = String(owner ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error('GitHub repository owner cannot be empty');
  }

  return normalized;
}

export function parseGitHubRepositoryFromRemote(remoteUrl) {
  const value = String(remoteUrl ?? '').trim();

  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `${normalizeOwner(httpsMatch[1])}/${httpsMatch[2]}`;
  }

  const sshMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${normalizeOwner(sshMatch[1])}/${sshMatch[2]}`;
  }

  throw new Error(`Unsupported Git remote for GitHub repository detection: ${value}`);
}

export function parseGitHubOwnerFromRemote(remoteUrl) {
  const value = String(remoteUrl ?? '').trim();

  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/[^/]+(?:\.git)?$/i);
  if (httpsMatch) {
    return normalizeOwner(httpsMatch[1]);
  }

  const sshMatch = value.match(/^git@github\.com:([^/]+)\/[^/]+(?:\.git)?$/i);
  if (sshMatch) {
    return normalizeOwner(sshMatch[1]);
  }

  throw new Error(`Unsupported Git remote for GitHub owner detection: ${value}`);
}

export function detectRepositorySlug({ repository, remoteUrl, cwd } = {}) {
  if (repository) {
    return String(repository).trim();
  }

  if (remoteUrl) {
    return parseGitHubRepositoryFromRemote(remoteUrl);
  }

  const detectedRemote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  return parseGitHubRepositoryFromRemote(detectedRemote);
}

export function detectRepositoryOwner({ repositoryOwner, repository, remoteUrl, cwd } = {}) {
  if (repositoryOwner) {
    return normalizeOwner(repositoryOwner);
  }

  if (repository) {
    const [owner] = String(repository).split('/');
    return normalizeOwner(owner);
  }

  if (remoteUrl) {
    return parseGitHubOwnerFromRemote(remoteUrl);
  }

  const detectedRemote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  return parseGitHubOwnerFromRemote(detectedRemote);
}

export function deriveImageRepos({ repositoryOwner, repository, remoteUrl, cwd } = {}) {
  const owner = detectRepositoryOwner({ repositoryOwner, repository, remoteUrl, cwd });

  return {
    repositoryOwner: owner,
    gatewayRepo: `ghcr.io/${owner}/classroompath-gateway`,
    migrationsRepo: `ghcr.io/${owner}/classroompath-migrations`,
    openpathApiRepo: `ghcr.io/${owner}/classroompath-openpath-api`,
    spaRepo: `ghcr.io/${owner}/classroompath-spa`,
    verifierRepo: `ghcr.io/${owner}/classroompath-release-verifier`,
  };
}

export function deriveTaggedImageRefs({ sha, repositoryOwner, repository, remoteUrl, cwd } = {}) {
  const trimmedSha = String(sha ?? '').trim();
  if (!trimmedSha) {
    throw new Error('Image tag SHA cannot be empty');
  }

  const repos = deriveImageRepos({ repositoryOwner, repository, remoteUrl, cwd });

  return {
    repositoryOwner: repos.repositoryOwner,
    gatewayRepo: repos.gatewayRepo,
    migrationsRepo: repos.migrationsRepo,
    openpathApiRepo: repos.openpathApiRepo,
    spaRepo: repos.spaRepo,
    verifierRepo: repos.verifierRepo,
    gatewayTag: `${repos.gatewayRepo}:${trimmedSha}`,
    migrationsTag: `${repos.migrationsRepo}:${trimmedSha}`,
    openpathApiTag: `${repos.openpathApiRepo}:${trimmedSha}`,
    spaTag: `${repos.spaRepo}:${trimmedSha}`,
    verifierTag: `${repos.verifierRepo}:${trimmedSha}`,
  };
}

function parseManifestAssignments(content) {
  const assignments = {};

  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    assignments[key] = value;
  }

  return assignments;
}

export function parseReleaseCandidateManifest(content, { sha } = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to validate a release candidate manifest');
  }

  const assignments = parseManifestAssignments(content);
  const manifest = {
    appSha: assignments.APP_SHA,
    gatewayImage: assignments.CLASSROOMPATH_GATEWAY_IMAGE,
    migrationsImage: assignments.CLASSROOMPATH_MIGRATIONS_IMAGE,
    openpathApiImage: assignments.OPENPATH_API_IMAGE,
    linuxAgentVersion: assignments.OPENPATH_LINUX_AGENT_VERSION ?? '',
    spaImage: assignments.CLASSROOMPATH_SPA_IMAGE,
    verifierImage: assignments.CLASSROOMPATH_VERIFIER_IMAGE,
  };

  for (const [key, value] of Object.entries({
    appSha: manifest.appSha,
    gatewayImage: manifest.gatewayImage,
    migrationsImage: manifest.migrationsImage,
    openpathApiImage: manifest.openpathApiImage,
    spaImage: manifest.spaImage,
    verifierImage: manifest.verifierImage,
  })) {
    if (!value) {
      throw new Error(`Release candidate manifest is missing required value: ${key}`);
    }
  }

  if (manifest.appSha !== targetSha) {
    throw new Error(
      `Release candidate manifest APP_SHA ${manifest.appSha} does not match target SHA ${targetSha}`
    );
  }

  return manifest;
}

export function selectLatestReleaseCandidateRun(payload, { sha } = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to select a release candidate workflow run');
  }

  const selected = sortWorkflowRunsNewestFirst(payload).filter((rawRun) => {
    if (!rawRun) {
      return false;
    }

    return (
      normalizeWorkflowRunHeadSha(rawRun) === targetSha &&
      rawRun.event === 'push' &&
      withNormalizedWorkflowRunId(rawRun)?.id
    );
  })[0];

  if (!selected) {
    throw new Error(`No release candidate workflow run found for SHA ${targetSha}`);
  }

  return withNormalizedWorkflowRunId(selected);
}

export function selectSuccessfulReleaseCandidateRun(payload, { sha } = {}) {
  const candidate = withNormalizedWorkflowRunId(
    sortWorkflowRunsNewestFirst(payload).filter((rawRun) => {
      if (!rawRun) {
        return false;
      }

      return (
        normalizeWorkflowRunHeadSha(rawRun) === String(sha ?? '').trim() &&
        rawRun.event === 'push' &&
        rawRun.conclusion === 'success' &&
        withNormalizedWorkflowRunId(rawRun)?.id
      );
    })[0]
  );

  if (!candidate) {
    throw new Error(`No successful release candidate workflow run found for SHA ${sha}`);
  }

  if (candidate.conclusion !== 'success') {
    throw new Error(
      `Latest release candidate workflow run for SHA ${sha} is not successful (status=${candidate.status ?? 'unknown'}, conclusion=${candidate.conclusion ?? 'unknown'})`
    );
  }

  if (candidate.status && candidate.status !== 'completed') {
    throw new Error(
      `Latest release candidate workflow run for SHA ${sha} has not completed yet (status=${candidate.status ?? 'unknown'})`
    );
  }

  return candidate;
}

export function selectLatestSuccessfulWorkflowRun(payload) {
  const candidate = withNormalizedWorkflowRunId(
    sortWorkflowRunsNewestFirst(payload).filter((rawRun) => {
      if (!rawRun) {
        return false;
      }

      return (
        rawRun.event === 'push' &&
        rawRun.conclusion === 'success' &&
        withNormalizedWorkflowRunId(rawRun)?.id
      );
    })[0]
  );

  if (!candidate) {
    throw new Error('No successful workflow run found');
  }

  if (candidate.status && candidate.status !== 'completed') {
    throw new Error(
      `Latest successful workflow run has not completed yet (status=${candidate.status ?? 'unknown'})`
    );
  }

  return candidate;
}

export function buildReleaseImageOutputs(refs) {
  return {
    repository_owner: refs.repositoryOwner,
    gateway_repo: refs.gatewayRepo,
    migrations_repo: refs.migrationsRepo,
    openpath_api_repo: refs.openpathApiRepo,
    spa_repo: refs.spaRepo,
    verifier_repo: refs.verifierRepo,
    gateway_tag: refs.gatewayTag,
    migrations_tag: refs.migrationsTag,
    openpath_api_tag: refs.openpathApiTag,
    spa_tag: refs.spaTag,
    verifier_tag: refs.verifierTag,
  };
}

export function buildReleaseManifestOutputs(parsedManifest) {
  return {
    app_sha: parsedManifest.appSha,
    gateway_image: parsedManifest.gatewayImage,
    migrations_image: parsedManifest.migrationsImage,
    openpath_api_image: parsedManifest.openpathApiImage,
    linux_agent_version: parsedManifest.linuxAgentVersion,
    spa_image: parsedManifest.spaImage,
    verifier_image: parsedManifest.verifierImage,
  };
}
