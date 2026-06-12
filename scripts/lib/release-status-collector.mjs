#!/usr/bin/env node
// @ts-check

/**
 * Collects all evidence needed to determine release status: release candidate runs, staging verification state, production deploy state, and OpenPath required checks.
 *
 * Invoked by: Imported by `scripts/release-status.mjs` (the `npm run release:status` CLI entry point).
 * Usage: (library module, not invoked directly)
 * Tested by `tests/release-status.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import {
  normalizeWorkflowRunHeadSha,
  normalizeWorkflowRunId,
  normalizeWorkflowRunUpdatedAt,
  sortWorkflowRunsNewestFirst,
} from './github-actions.mjs';
import {
  OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
  resolveOpenPathRequiredChecks,
} from './openpath-ci-checks.mjs';
import {
  buildCanonicalReleaseManifest,
  parseArtifactReleaseManifestText,
  parseCanonicalReleaseManifestText,
} from './release-manifest.mjs';
import { parseReleaseStateText } from './release-state-contract.mjs';
import { detectRepositorySlug } from './release-images.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..', '..');

const DEFAULT_OPENPATH_REPO = 'balejosg/openpath';
const RC_WORKFLOW = 'release-candidate-images.yml';
const PRODUCTION_DEPLOY_WORKFLOW = 'deploy.yml';
const DEFAULT_STAGING_DEPLOY_ROOT = '/srv/classroompath';

function usage() {
  return `Usage: npm run release:status -- [--sha <classroompath-sha>] [--openpath-sha <sha>] [--json]

Prints read-only local promotion status for the current ClassroomPath checkout.

Options:
  --sha <sha>           ClassroomPath SHA to inspect. Defaults to local HEAD.
  --openpath-sha <sha>  OpenPath SHA to inspect. Defaults to the upstream/openpath submodule SHA.
  --json                Emit machine-readable JSON.
  --help                Show this help.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

export function parseReleaseStatusArgs(argv) {
  const parsed = {
    sha: '',
    openpathSha: '',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--sha':
        parsed.sha = readValue(argv, ++index, arg);
        break;
      case '--openpath-sha':
        parsed.openpathSha = readValue(argv, ++index, arg);
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function defaultRunCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: options.encoding === 'buffer' ? 'buffer' : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryRead(label, reader) {
  try {
    return { ok: true, value: reader(), error: '' };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
      label,
    };
  }
}

function parseJsonOrEmpty(text, fallback) {
  if (!text) {
    return fallback;
  }

  return JSON.parse(text);
}

function shortSha(value) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 12) : 'n/a';
}

function valueOrNA(value) {
  const text = String(value ?? '').trim();
  return text || 'n/a';
}

function normalizeTag(value) {
  const text = String(value ?? '').trim();
  return text ? `v${text.replace(/^v/, '')}` : '';
}

export function resolveNextPatchTagFromRemoteTags(text) {
  const tags = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .map((tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag))
    .filter(Boolean)
    .map((match) => ({
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    }))
    .sort((left, right) => {
      if (left.major !== right.major) return right.major - left.major;
      if (left.minor !== right.minor) return right.minor - left.minor;
      return right.patch - left.patch;
    });

  if (tags.length === 0) {
    return '';
  }

  const latest = tags[0];
  return `v${latest.major}.${latest.minor}.${latest.patch + 1}`;
}

function expandTilde(path, env) {
  const value = String(path ?? '').trim();
  if (value === '~') {
    return env.HOME ?? value;
  }

  if (value.startsWith('~/')) {
    return resolve(env.HOME ?? '.', value.slice(2));
  }

  return value;
}

function readEnvFileIfPresent(env, filePath) {
  if (!existsSync(filePath)) {
    return env;
  }

  const merged = { ...env };
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key || key in merged) {
      continue;
    }

    merged[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return merged;
}

function latestMatchingRun(runs, sha) {
  return (
    sortWorkflowRunsNewestFirst(runs).find(
      (run) =>
        normalizeWorkflowRunHeadSha(run) === sha &&
        (run.event === 'push' || run.event === 'workflow_dispatch')
    ) ?? null
  );
}

function latestRun(runs) {
  return sortWorkflowRunsNewestFirst(runs)[0] ?? null;
}

function normalizeRun(run) {
  if (!run) {
    return null;
  }

  return {
    databaseId: normalizeWorkflowRunId(run),
    headSha: normalizeWorkflowRunHeadSha(run),
    status: run.status ?? 'unknown',
    conclusion: run.conclusion ?? null,
    updatedAt: normalizeWorkflowRunUpdatedAt(run),
    url: run.url ?? run.html_url ?? null,
  };
}

function normalizeReleaseRun(run) {
  if (!run) {
    return null;
  }

  return {
    runId: run.databaseId,
    databaseId: run.databaseId,
    headSha: run.headSha,
    status: run.conclusion ?? run.status ?? 'unknown',
    workflowStatus: run.status,
    conclusion: run.conclusion,
    updatedAt: run.updatedAt,
    url: run.url,
  };
}

export function detectOperationalTargetPlaceholders(env) {
  const proxmoxAlias = String(env.PROXMOX_SSH_ALIAS ?? '').trim();
  const windowsRunnerProxmoxHost = String(env.WINDOWS_RUNNER_PROXMOX_HOST ?? '').trim();
  const proxmoxHost = String(env.PROXMOX_HOST ?? '').trim();
  const proxmoxTarget =
    proxmoxHost && !/(^|[.])example[.]invalid$/.test(proxmoxHost)
      ? ['PROXMOX_HOST', proxmoxHost]
      : proxmoxAlias
        ? ['PROXMOX_SSH_ALIAS', proxmoxAlias]
        : windowsRunnerProxmoxHost
          ? ['WINDOWS_RUNNER_PROXMOX_HOST', windowsRunnerProxmoxHost]
          : ['PROXMOX_HOST', proxmoxHost || 'proxmox-host.example.invalid'];

  return [
    ['STAGING_HOST', env.STAGING_HOST ?? 'staging-host.example.invalid'],
    ['DEPLOY_HOST', env.DEPLOY_HOST ?? 'classroompath.example.invalid'],
    proxmoxTarget,
  ]
    .map(([name, value]) => ({ name, value: String(value ?? '').trim() }))
    .filter(({ value }) => value && /(^|[.])example[.]invalid$/.test(value));
}

function runGit(runCommand, args, env) {
  return String(runCommand('git', args, { cwd: projectRoot, env })).trim();
}

function runGh(runCommand, args, env) {
  return String(runCommand('gh', args, { cwd: projectRoot, env })).trim();
}

function parseCheckRuns(payload) {
  return Array.isArray(payload?.check_runs) ? payload.check_runs : [];
}

function parseCheckRunTimestamp(checkRun) {
  const timestamp = Date.parse(checkRun?.completed_at ?? checkRun?.started_at ?? '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function summarizeRequiredChecks(checkRuns, requiredChecks) {
  const latestByName = new Map();
  for (const checkRun of checkRuns) {
    const previous = latestByName.get(checkRun.name);
    if (!previous || parseCheckRunTimestamp(checkRun) >= parseCheckRunTimestamp(previous)) {
      latestByName.set(checkRun.name, checkRun);
    }
  }

  return requiredChecks.map((name) => {
    const checkRun = latestByName.get(name);
    return {
      name,
      status: checkRun?.status === 'completed' ? (checkRun.conclusion ?? 'unknown') : 'pending',
      detailsUrl: checkRun?.details_url ?? checkRun?.html_url ?? null,
    };
  });
}

function resolvePreviousReleaseOpenPathSha(runCommand, env) {
  const tags = runGit(runCommand, ['tag', '--sort=-creatordate'], env)
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => /^v/.test(tag));

  for (const tag of tags) {
    try {
      return runGit(runCommand, ['rev-parse', `${tag}:upstream/openpath`], env);
    } catch {
      continue;
    }
  }

  return '';
}

function resolveOpenPathChangedFiles({ runCommand, env, baseSha, sha }) {
  if (!baseSha || baseSha === sha) {
    return [];
  }

  return runGit(runCommand, ['-C', 'upstream/openpath', 'diff', '--name-only', baseSha, sha], env)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildSshArgs({ host, user, port, key, strictHostKey, remoteCommand }) {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    `StrictHostKeyChecking=${strictHostKey}`,
    '-p',
    String(port),
    '-i',
    key,
    `${user}@${host}`,
    remoteCommand,
  ];
}

function resolveStagingAccess(env) {
  const key =
    env.RELEASE_STATUS_STAGING_SSH_KEY ||
    env.STAGING_SSH_KEY ||
    `${env.HOME}/.ssh/classroompath_staging`;
  return {
    host: env.STAGING_HOST || 'staging-host.example.invalid',
    user: env.STAGING_USER || 'deploy',
    port: env.STAGING_PORT || '22',
    key: expandTilde(key, env),
    strictHostKey: env.STAGING_SSH_STRICT_HOSTKEY || 'accept-new',
    deployRoot: env.CLASSROOMPATH_STAGING_DEPLOY_ROOT || DEFAULT_STAGING_DEPLOY_ROOT,
  };
}

function resolveProductionAccess(env) {
  const key =
    env.RELEASE_STATUS_PRODUCTION_SSH_KEY ||
    env.DEPLOY_SSH_KEY ||
    `${env.HOME}/.ssh/classroompath_deploy`;
  return {
    host: env.DEPLOY_HOST || 'classroompath.example.invalid',
    user: env.DEPLOY_USER || 'deploy',
    port: env.DEPLOY_PORT || '22',
    key: expandTilde(key, env),
    strictHostKey: env.DEPLOY_SSH_STRICT_HOSTKEY || 'accept-new',
    deployRoot: env.CLASSROOMPATH_DEPLOY_ROOT || '',
  };
}

function readRemoteState({ runCommand, env, access, fileName }) {
  if (!access.deployRoot) {
    return {
      ok: false,
      state: null,
      error: `CLASSROOMPATH_DEPLOY_ROOT is required for read-only ${fileName} read`,
    };
  }

  if (!access.key || (!env.RELEASE_STATUS_TEST_MODE && !existsSync(access.key))) {
    return {
      ok: false,
      state: null,
      error: `SSH key not available for read-only ${fileName} read`,
    };
  }

  const stateDir = `${String(access.deployRoot).replace(/\/+$/, '')}/release-state`;
  const remoteCommand = `test -f ${stateDir}/${fileName} && cat ${stateDir}/${fileName}`;
  const text = runCommand('ssh', buildSshArgs({ ...access, remoteCommand }), {
    cwd: projectRoot,
    env,
  });

  return {
    ok: true,
    state: parseReleaseStateText(text),
    error: '',
  };
}

function extractZipEntries(zipBuffer) {
  const centralDirectoryEntries = extractZipEntriesFromCentralDirectory(zipBuffer);
  if (centralDirectoryEntries.length > 0) {
    return centralDirectoryEntries;
  }

  const entries = [];
  let offset = 0;

  while (offset + 30 < zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (fileNameEnd > zipBuffer.length || dataEnd > zipBuffer.length) {
      break;
    }

    const name = zipBuffer.subarray(fileNameStart, fileNameEnd).toString('utf8');
    const compressedData = zipBuffer.subarray(dataStart, dataEnd);
    let data = null;

    if (compressionMethod === 0) {
      data = compressedData;
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressedData);
    }

    if (data) {
      entries.push({ name, text: data.toString('utf8') });
    }

    offset = dataEnd;
  }

  return entries;
}

function extractZipEntriesFromCentralDirectory(zipBuffer) {
  const entries = [];
  let offset = 0;

  while (offset + 46 < zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (fileNameEnd > zipBuffer.length || dataEnd > zipBuffer.length) {
      break;
    }

    const name = zipBuffer.subarray(fileNameStart, fileNameEnd).toString('utf8');
    const compressedData = zipBuffer.subarray(dataStart, dataEnd);
    let data = null;

    if (compressionMethod === 0) {
      data = compressedData;
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressedData);
    }

    if (data) {
      entries.push({ name, text: data.toString('utf8') });
    }

    offset = fileNameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractManifestTextFromArtifact(payload) {
  if (typeof payload === 'string') {
    return payload;
  }

  if (!Buffer.isBuffer(payload)) {
    return '';
  }

  const entries = extractZipEntries(payload);
  return (
    entries.find((entry) => /release-candidate.*\.(env|txt)$/i.test(entry.name))?.text ??
    entries.find((entry) => /\.(env|txt)$/i.test(entry.name))?.text ??
    ''
  );
}

function parseReleaseCandidateManifestText(text, { sha, repo, runId }) {
  try {
    return parseCanonicalReleaseManifestText(text, { sha });
  } catch {
    return buildCanonicalReleaseManifest({
      repository: repo,
      runId: String(runId),
      manifest: parseArtifactReleaseManifestText(text, { sha }),
    });
  }
}

function readReleaseCandidateManifest({ runCommand, env, repo, run, sha }) {
  if (env.RELEASE_STATUS_TEST_MANIFEST) {
    return {
      status: 'read',
      artifactName: `release-candidate-images-${sha}`,
      manifest: parseReleaseCandidateManifestText(env.RELEASE_STATUS_TEST_MANIFEST, {
        sha,
        repo,
        runId: run?.databaseId ?? '',
      }),
      error: '',
    };
  }

  if (!run?.databaseId) {
    return { status: 'missing-run', artifactName: '', manifest: null, error: '' };
  }

  const artifactMetadata = parseJsonOrEmpty(
    runGh(
      runCommand,
      ['api', `repos/${repo}/actions/runs/${String(run.databaseId)}/artifacts`],
      env
    ),
    {}
  );
  const artifactName = `release-candidate-images-${sha}`;
  const artifact = (artifactMetadata.artifacts ?? []).find((item) => item.name === artifactName);

  if (!artifact) {
    return { status: 'missing-artifact', artifactName, manifest: null, error: '' };
  }

  const artifactPayload = runCommand(
    'gh',
    [
      'api',
      `repos/${repo}/actions/artifacts/${artifact.id ?? artifact.databaseId ?? artifactName}/zip`,
    ],
    { cwd: projectRoot, env, encoding: 'buffer' }
  );
  const artifactText = extractManifestTextFromArtifact(artifactPayload);

  try {
    return {
      status: artifact.expired ? 'expired' : 'read',
      artifactName,
      manifest: parseReleaseCandidateManifestText(artifactText, {
        sha,
        repo,
        runId: run.databaseId,
      }),
      error: '',
    };
  } catch (error) {
    return {
      status: artifact.expired ? 'expired' : 'present',
      artifactName,
      manifest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function collectReleaseStatusEvidence({
  argv = [],
  env = process.env,
  runCommand = defaultRunCommand,
} = {}) {
  const args = parseReleaseStatusArgs(argv);
  const mergedEnv = readEnvFileIfPresent(env, resolve(projectRoot, '.env.local'));
  const classroomSha = args.sha || runGit(runCommand, ['rev-parse', 'HEAD'], mergedEnv);
  const openpathSha =
    args.openpathSha || runGit(runCommand, ['rev-parse', 'HEAD:upstream/openpath'], mergedEnv);

  const repository = detectRepositorySlug({
    remoteUrl: runGit(runCommand, ['remote', 'get-url', 'origin'], mergedEnv),
  });

  const originMain = tryRead('origin/main', () =>
    runGit(runCommand, ['rev-parse', 'origin/main'], mergedEnv)
  );

  const rcRuns = tryRead('release candidate runs', () =>
    parseJsonOrEmpty(
      runGh(
        runCommand,
        [
          'run',
          'list',
          '--repo',
          repository,
          '--workflow',
          RC_WORKFLOW,
          '--json',
          'databaseId,headSha,event,status,conclusion,updatedAt,url',
          '--limit',
          '50',
        ],
        mergedEnv
      ),
      []
    )
  );
  const rcRun = normalizeRun(rcRuns.ok ? latestMatchingRun(rcRuns.value, classroomSha) : null);
  const manifest = tryRead('release candidate manifest', () =>
    readReleaseCandidateManifest({
      runCommand,
      env: mergedEnv,
      repo: repository,
      run: rcRun,
      sha: classroomSha,
    })
  );

  const checkRuns = tryRead('OpenPath check runs', () =>
    parseCheckRuns(
      parseJsonOrEmpty(
        runGh(
          runCommand,
          ['api', `repos/${DEFAULT_OPENPATH_REPO}/commits/${openpathSha}/check-runs`, '--paginate'],
          mergedEnv
        ),
        {}
      )
    )
  );
  const openPathBaseSha = tryRead('previous release OpenPath SHA', () =>
    resolvePreviousReleaseOpenPathSha(runCommand, mergedEnv)
  );
  const openPathChangedFiles = tryRead('OpenPath changed files', () =>
    resolveOpenPathChangedFiles({
      runCommand,
      env: mergedEnv,
      baseSha: openPathBaseSha.ok ? openPathBaseSha.value : '',
      sha: openpathSha,
    })
  );
  const requiredCheckResolution = resolveOpenPathRequiredChecks({
    changedFiles: openPathChangedFiles.ok ? openPathChangedFiles.value : [],
  });

  const stagingVerification = tryRead('staging verification state', () =>
    readRemoteState({
      runCommand,
      env: mergedEnv,
      access: resolveStagingAccess(mergedEnv),
      fileName: 'staging-verification.env',
    })
  );

  const stagingCurrentImages = tryRead('staging current images state', () =>
    readRemoteState({
      runCommand,
      env: mergedEnv,
      access: resolveStagingAccess(mergedEnv),
      fileName: 'current-images.env',
    })
  );

  const productionState = tryRead('production current state', () =>
    readRemoteState({
      runCommand,
      env: mergedEnv,
      access: resolveProductionAccess(mergedEnv),
      fileName: 'current-images.env',
    })
  );

  const productionRuns = tryRead('production deploy runs', () =>
    parseJsonOrEmpty(
      runGh(
        runCommand,
        [
          'run',
          'list',
          '--repo',
          repository,
          '--workflow',
          PRODUCTION_DEPLOY_WORKFLOW,
          '--json',
          'databaseId,headSha,event,status,conclusion,updatedAt,url',
          '--limit',
          '20',
        ],
        mergedEnv
      ),
      []
    )
  );

  const remoteTags = tryRead('remote release tags', () =>
    runGit(runCommand, ['ls-remote', '--tags', '--refs', 'origin', 'v*'], mergedEnv)
  );

  const status = {
    generatedAt: new Date().toISOString(),
    classroomPath: {
      repository,
      headSha: classroomSha,
      originMainSha: originMain.ok ? originMain.value : null,
      originMainError: originMain.ok ? '' : originMain.error,
    },
    openPath: {
      repository: DEFAULT_OPENPATH_REPO,
      submoduleSha: openpathSha,
      baseSha: openPathBaseSha.ok ? openPathBaseSha.value : '',
      changedFiles: openPathChangedFiles.ok ? openPathChangedFiles.value : [],
      requiredChecks: checkRuns.ok
        ? summarizeRequiredChecks(checkRuns.value, requiredCheckResolution.requiredChecks)
        : [],
      requiredChecksError: checkRuns.ok ? '' : checkRuns.error,
      prereleaseAptRequiredCheck: OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
    },
    releaseCandidate: {
      workflow: RC_WORKFLOW,
      latestRun: rcRun,
      runsError: rcRuns.ok ? '' : rcRuns.error,
      manifest: manifest.ok ? manifest.value.manifest : null,
      manifestStatus: manifest.ok ? manifest.value.status : 'unreadable',
      manifestArtifact: manifest.ok ? manifest.value.artifactName : '',
      manifestError: manifest.ok ? manifest.value.error : manifest.error,
    },
    prereleaseApt: {
      pin: manifest.ok ? (manifest.value.manifest?.linux_agent_apt_suite ?? null) : null,
      requiredCheck: OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
    },
    stagingVerification: stagingVerification.ok
      ? stagingVerification.value
      : { ok: false, state: null, error: stagingVerification.error },
    stagingCurrentImages: stagingCurrentImages.ok
      ? stagingCurrentImages.value
      : { ok: false, state: null, error: stagingCurrentImages.error },
    productionDeploy: {
      workflow: PRODUCTION_DEPLOY_WORKFLOW,
      latestRun: productionRuns.ok ? normalizeRun(latestRun(productionRuns.value)) : null,
      runsError: productionRuns.ok ? '' : productionRuns.error,
      currentState: productionState.ok ? productionState.value.state : null,
      currentStateError: productionState.ok ? productionState.value.error : productionState.error,
    },
    release: {
      nextTag: normalizeTag(
        mergedEnv.RELEASE_STATUS_NEXT_TAG ??
          mergedEnv.RELEASE_PREFLIGHT_NEXT_TAG ??
          (remoteTags.ok ? resolveNextPatchTagFromRemoteTags(remoteTags.value) : '')
      ),
      nextTagError: remoteTags.ok ? '' : remoteTags.error,
    },
    operationalTargets: {
      placeholders: detectOperationalTargetPlaceholders(mergedEnv),
    },
  };

  return status;
}
