import { execFileSync } from 'node:child_process';
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
    gatewayTag: `${repos.gatewayRepo}:${trimmedSha}`,
    migrationsTag: `${repos.migrationsRepo}:${trimmedSha}`,
    openpathApiTag: `${repos.openpathApiRepo}:${trimmedSha}`,
    spaTag: `${repos.spaRepo}:${trimmedSha}`,
  };
}

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/release-images.mjs outputs --sha <sha> [--owner <owner>]');
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

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
}

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

  if (command !== 'outputs' || !options.sha) {
    printUsage();
    process.exit(1);
  }

  const refs = deriveTaggedImageRefs({
    sha: options.sha,
    repositoryOwner: options.owner ?? process.env.GITHUB_REPOSITORY_OWNER,
    repository: process.env.GITHUB_REPOSITORY,
  });

  const outputMap = {
    repository_owner: refs.repositoryOwner,
    gateway_repo: refs.gatewayRepo,
    migrations_repo: refs.migrationsRepo,
    openpath_api_repo: refs.openpathApiRepo,
    spa_repo: refs.spaRepo,
    gateway_tag: refs.gatewayTag,
    migrations_tag: refs.migrationsTag,
    openpath_api_tag: refs.openpathApiTag,
    spa_tag: refs.spaTag,
  };

  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
