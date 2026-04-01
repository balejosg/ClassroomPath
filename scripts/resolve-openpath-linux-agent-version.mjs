import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');
const DEFAULT_OPENPATH_DIR = resolve(projectRoot, 'upstream/openpath');
const DEFAULT_PACKAGES_URL =
  'https://balejosg.github.io/openpath/apt/dists/stable/main/binary-amd64/Packages';

const LINUX_AGENT_CONTRACT_PATHS = [
  'linux/',
  'api/src/routes/enrollment.ts',
  'api/src/lib/server-assets.ts',
];

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/resolve-openpath-linux-agent-version.mjs [--openpath-dir <path>] [--packages-url <url>]'
  );
}

function parseCliArgs(argv) {
  const options = {
    openpathDir: DEFAULT_OPENPATH_DIR,
    packagesUrl: DEFAULT_PACKAGES_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--openpath-dir') {
      options.openpathDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--packages-url') {
      options.packagesUrl = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }

  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseReleaseTagVersion(tag) {
  const match = String(tag ?? '')
    .trim()
    .match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((segment) => Number(segment));
}

function compareReleaseTags(left, right) {
  const leftVersion = parseReleaseTagVersion(left);
  const rightVersion = parseReleaseTagVersion(right);

  if (!leftVersion && !rightVersion) {
    return 0;
  }

  if (!leftVersion) {
    return -1;
  }

  if (!rightVersion) {
    return 1;
  }

  for (let index = 0; index < leftVersion.length; index += 1) {
    if (leftVersion[index] !== rightVersion[index]) {
      return leftVersion[index] - rightVersion[index];
    }
  }

  return 0;
}

export function selectLatestReachableOpenPathReleaseTag(tags) {
  const candidates = [...new Set(normalizeList(tags))].filter((tag) => parseReleaseTagVersion(tag));
  if (candidates.length === 0) {
    return '';
  }

  candidates.sort(compareReleaseTags);
  return candidates.at(-1) ?? '';
}

export function stripDebianRevision(version) {
  const trimmed = String(version ?? '').trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(/-[^-]+$/, '');
}

export function parsePublishedOpenPathLinuxVersions(content) {
  const versions = new Set();

  for (const block of String(content ?? '').split(/\r?\n\r?\n+/)) {
    let packageName = '';
    let version = '';

    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (key === 'Package') {
        packageName = value;
      } else if (key === 'Version') {
        version = stripDebianRevision(value);
      }
    }

    if (packageName === 'openpath-dnsmasq' && version) {
      versions.add(version);
    }
  }

  return [...versions].sort((left, right) => compareReleaseTags(`v${left}`, `v${right}`));
}

export function touchesLinuxAgentContract(changedFiles) {
  return normalizeList(changedFiles).some((filePath) => {
    return LINUX_AGENT_CONTRACT_PATHS.some((contractPath) => {
      return contractPath.endsWith('/')
        ? filePath.startsWith(contractPath)
        : filePath === contractPath;
    });
  });
}

export function resolveOpenPathLinuxAgentVersion({
  publishedVersions,
  reachableTags,
  changedFilesSinceTag,
}) {
  const tag = selectLatestReachableOpenPathReleaseTag(reachableTags);
  if (!tag) {
    throw new Error('OpenPath submodule does not contain a reachable stable v* release tag');
  }

  const version = tag.slice(1);
  if (!new Set(normalizeList(publishedVersions)).has(version)) {
    throw new Error(
      `OpenPath stable APT metadata does not advertise openpath-dnsmasq ${version}. Publish that package before promoting this ClassroomPath commit.`
    );
  }

  if (touchesLinuxAgentContract(changedFilesSinceTag)) {
    throw new Error(
      `OpenPath submodule contains Linux agent changes after ${tag}. Publish a new stable openpath-dnsmasq release before promoting this ClassroomPath commit.`
    );
  }

  return { tag, version };
}

function gitOutput(openpathDir, args) {
  return execFileSync('git', ['-C', openpathDir, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isShallowRepository(openpathDir) {
  return gitOutput(openpathDir, ['rev-parse', '--is-shallow-repository']) === 'true';
}

export function buildFetchOpenPathTagsArgs({ shallow }) {
  return shallow
    ? ['-C', DEFAULT_OPENPATH_DIR, 'fetch', '--force', '--tags', '--unshallow', 'origin']
    : ['-C', DEFAULT_OPENPATH_DIR, 'fetch', '--force', '--tags', 'origin'];
}

function fetchOpenPathTags(openpathDir) {
  const shallow = isShallowRepository(openpathDir);
  const args = buildFetchOpenPathTagsArgs({ shallow }).map((entry, index) => {
    if (index === 1) {
      return openpathDir;
    }

    return entry;
  });

  execFileSync('git', args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listReachableReleaseTags(openpathDir) {
  return normalizeList(gitOutput(openpathDir, ['tag', '--merged', 'HEAD', '--list', 'v*']));
}

function listChangedFilesSinceTag(openpathDir, tag) {
  return normalizeList(
    gitOutput(openpathDir, [
      'diff',
      '--name-only',
      `${tag}..HEAD`,
      '--',
      'linux',
      'api/src/routes/enrollment.ts',
      'api/src/lib/server-assets.ts',
    ])
  );
}

async function downloadPackagesManifest(packagesUrl) {
  const response = await fetch(packagesUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download OpenPath stable APT metadata from ${packagesUrl} (${response.status} ${response.statusText})`
    );
  }

  return response.text();
}

function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  fetchOpenPathTags(options.openpathDir);

  const reachableTags = listReachableReleaseTags(options.openpathDir);
  const packagesManifest = await downloadPackagesManifest(options.packagesUrl);
  const publishedVersions = parsePublishedOpenPathLinuxVersions(packagesManifest);
  const tag = selectLatestReachableOpenPathReleaseTag(reachableTags);
  const changedFilesSinceTag = tag ? listChangedFilesSinceTag(options.openpathDir, tag) : [];
  const result = resolveOpenPathLinuxAgentVersion({
    publishedVersions,
    reachableTags,
    changedFilesSinceTag,
  });

  writeOutputs({
    version: result.version,
    tag: result.tag,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  main().catch((error) => {
    printUsage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
