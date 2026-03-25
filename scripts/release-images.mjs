import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

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

export function detectRepositorySlug({ repository, remoteUrl, cwd = projectRoot } = {}) {
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

export function detectRepositoryOwner({
  repositoryOwner,
  repository,
  remoteUrl,
  cwd = projectRoot,
} = {}) {
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

function normalizeWorkflowRuns(payload) {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.workflow_runs)
      ? payload.workflow_runs
      : [];
}

function normalizeWorkflowRunId(run) {
  return run.id ?? run.databaseId;
}

function normalizeWorkflowRunHeadSha(run) {
  return run.head_sha ?? run.headSha;
}

function normalizeWorkflowRunUpdatedAt(run) {
  return run.updated_at ?? run.updatedAt ?? run.created_at ?? run.createdAt ?? 0;
}

function withNormalizedWorkflowRunId(run) {
  const runId = normalizeWorkflowRunId(run);
  if (!runId) {
    return run;
  }

  if (run.id) {
    return run;
  }

  return {
    ...run,
    id: runId,
  };
}

export function selectLatestReleaseCandidateRun(payload, { sha } = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to select a release candidate workflow run');
  }

  const selected = normalizeWorkflowRuns(payload)
    .filter((rawRun) => {
      if (!rawRun) {
        return false;
      }

      return (
        normalizeWorkflowRunHeadSha(rawRun) === targetSha &&
        rawRun.event === 'push' &&
        normalizeWorkflowRunId(rawRun)
      );
    })
    .sort((leftRaw, rightRaw) => {
      const leftTime = Date.parse(normalizeWorkflowRunUpdatedAt(leftRaw));
      const rightTime = Date.parse(normalizeWorkflowRunUpdatedAt(rightRaw));
      return rightTime - leftTime;
    })[0];

  if (!selected) {
    throw new Error(`No release candidate workflow run found for SHA ${targetSha}`);
  }

  return withNormalizedWorkflowRunId(selected);
}

export function selectSuccessfulReleaseCandidateRun(payload, { sha } = {}) {
  const candidate = withNormalizedWorkflowRunId(
    normalizeWorkflowRuns(payload)
      .filter((rawRun) => {
        if (!rawRun) {
          return false;
        }

        return (
          normalizeWorkflowRunHeadSha(rawRun) === String(sha ?? '').trim() &&
          rawRun.event === 'push' &&
          rawRun.conclusion === 'success' &&
          normalizeWorkflowRunId(rawRun)
        );
      })
      .sort((leftRaw, rightRaw) => {
        const leftTime = Date.parse(normalizeWorkflowRunUpdatedAt(leftRaw));
        const rightTime = Date.parse(normalizeWorkflowRunUpdatedAt(rightRaw));
        return rightTime - leftTime;
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
    spaImage: assignments.CLASSROOMPATH_SPA_IMAGE,
    verifierImage: assignments.CLASSROOMPATH_VERIFIER_IMAGE,
  };

  for (const [key, value] of Object.entries(manifest)) {
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

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/release-images.mjs outputs --sha <sha> [--owner <owner>]');
  console.error(
    '  node scripts/release-images.mjs select-run-id --sha <sha> --runs-file <workflow-runs.json>'
  );
  console.error(
    '  node scripts/release-images.mjs manifest-outputs --sha <sha> --file <release-candidate-images.env>'
  );
}

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === '--sha') {
      options.sha = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--owner') {
      options.owner = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--file') {
      options.file = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--runs-file') {
      options.runsFile = rest[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
}

function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

  if (!options.sha) {
    printUsage();
    process.exit(1);
  }

  if (command === 'outputs') {
    const refs = deriveTaggedImageRefs({
      sha: options.sha,
      repositoryOwner: options.owner ?? process.env.GITHUB_REPOSITORY_OWNER,
      repository: process.env.GITHUB_REPOSITORY,
    });

    writeOutputs({
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
    });
    return;
  }

  if (command === 'select-run-id' && options.runsFile) {
    const payload = JSON.parse(readFileSync(options.runsFile, 'utf8'));
    const run = selectSuccessfulReleaseCandidateRun(payload, { sha: options.sha });
    writeOutputs({ run_id: run.id });
    return;
  }

  if (command === 'manifest-outputs' && options.file) {
    const manifest = parseReleaseCandidateManifest(readFileSync(options.file, 'utf8'), {
      sha: options.sha,
    });

    writeOutputs({
      app_sha: manifest.appSha,
      gateway_image: manifest.gatewayImage,
      migrations_image: manifest.migrationsImage,
      openpath_api_image: manifest.openpathApiImage,
      spa_image: manifest.spaImage,
      verifier_image: manifest.verifierImage,
    });
    return;
  }

  printUsage();
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
