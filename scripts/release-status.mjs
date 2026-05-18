#!/usr/bin/env node
// @ts-check

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { isDirectExecution } from './lib/github-actions.mjs';
import {
  normalizeWorkflowRunHeadSha,
  normalizeWorkflowRunId,
  normalizeWorkflowRunUpdatedAt,
  sortWorkflowRunsNewestFirst,
} from './lib/github-actions.mjs';
import { OPENPATH_PRERELEASE_APT_REQUIRED_CHECK } from './lib/openpath-ci-checks.mjs';
import {
  buildCanonicalReleaseManifest,
  parseArtifactReleaseManifestText,
  parseCanonicalReleaseManifestText,
} from './lib/release-manifest.mjs';
import { parseReleaseStateText } from './lib/release-state-contract.mjs';
import { detectRepositorySlug } from './lib/release-images.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

const DEFAULT_OPENPATH_REPO = 'balejosg/openpath';
const RC_WORKFLOW = 'release-candidate-images.yml';
const PRODUCTION_DEPLOY_WORKFLOW = 'deploy.yml';
const STATE_DIR = '/srv/classroompath/release-state';

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

function isSuccess(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'success'
  );
}

function isReleaseCandidateAvailable(releaseCandidate) {
  return (
    releaseCandidate.latestRun?.conclusion === 'success' &&
    releaseCandidate.manifestStatus === 'read' &&
    Boolean(releaseCandidate.manifest)
  );
}

function isStagingPromotionEligible({ status, stagingState, stagingCurrentImages }) {
  return (
    stagingState.STAGING_VERIFIED_APP_SHA === status.classroomPath.headSha &&
    stagingState.STAGING_VERIFIED_OPENPATH_SHA === status.openPath.submoduleSha &&
    stagingState.STAGING_VERIFIED_IMAGE_SOURCE === 'release-candidate' &&
    stagingCurrentImages.IMAGE_SOURCE === 'release-candidate' &&
    isSuccess(stagingState.STAGING_SMOKE_RESULT ?? stagingState.STAGING_SMOKE_STATUS) &&
    isSuccess(stagingState.STAGING_RELEASE_GATE_RESULT) &&
    isSuccess(stagingState.STAGING_PREPROMOTION_REHEARSAL_RESULT)
  );
}

function hasWindowsPrepromotionEvidence(stagingState) {
  return isSuccess(stagingState.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT);
}

function isProductionCurrentAtTarget(status) {
  return (
    status.productionDeploy.latestRun?.conclusion === 'success' &&
    status.productionDeploy.currentState?.APP_SHA === status.classroomPath.headSha
  );
}

export function deriveReleaseBlockers(status) {
  const groups = deriveReleaseBlockerGroups(status);
  return [...groups.promotionBlockers, ...groups.productionBlockers];
}

export function deriveReleaseBlockerGroups(status) {
  const blockers = [];
  const productionBlockers = [];
  const stagingState = status.stagingVerification.state ?? {};
  const stagingCurrentImages = status.stagingCurrentImages.state ?? {};

  if (
    status.classroomPath.originMainSha &&
    status.classroomPath.headSha !== status.classroomPath.originMainSha
  ) {
    blockers.push('classroompath-head-behind-origin');
  }

  if (
    status.openPath.requiredChecks.length === 0 ||
    status.openPath.requiredChecks.some((check) => check.status !== 'success')
  ) {
    blockers.push('openpath-required-checks-not-green');
  }

  if (!isReleaseCandidateAvailable(status.releaseCandidate)) {
    blockers.push('release-candidate-missing');
  }

  if (!isStagingPromotionEligible({ status, stagingState, stagingCurrentImages })) {
    blockers.push('staging-not-promotion-eligible');
  }

  if (!hasWindowsPrepromotionEvidence(stagingState)) {
    blockers.push('windows-prepromotion-evidence-missing');
  }

  if (status.productionDeploy.latestRun?.conclusion !== 'success') {
    productionBlockers.push('production-deploy-not-success');
  }

  return {
    promotionBlockers: blockers,
    productionBlockers,
  };
}

export function buildReleaseStatusJson(status) {
  const stagingState = status.stagingVerification.state ?? {};
  const stagingCurrentImages = status.stagingCurrentImages.state ?? {};
  const productionCurrentImages = status.productionDeploy.currentState ?? {};
  const releaseCandidateRun = normalizeReleaseRun(status.releaseCandidate.latestRun);
  const productionDeployRun = normalizeReleaseRun(status.productionDeploy.latestRun);
  const blockerGroups =
    status.promotionBlockers && status.productionBlockers
      ? {
          promotionBlockers: status.promotionBlockers,
          productionBlockers: status.productionBlockers,
        }
      : deriveReleaseBlockerGroups(status);
  const blockers =
    status.blockers ??
    (isProductionCurrentAtTarget(status)
      ? [...blockerGroups.productionBlockers]
      : [...blockerGroups.promotionBlockers, ...blockerGroups.productionBlockers]);

  return {
    classroompath: {
      head: status.classroomPath.headSha,
      headSha: status.classroomPath.headSha,
      originMain: status.classroomPath.originMainSha,
      originMainSha: status.classroomPath.originMainSha,
      repository: status.classroomPath.repository,
    },
    openpath: {
      repository: status.openPath.repository,
      submoduleSha: status.openPath.submoduleSha,
      requiredChecks: status.openPath.requiredChecks,
      prereleaseAptRequiredCheck: status.openPath.prereleaseAptRequiredCheck,
    },
    releaseCandidate: {
      runId: releaseCandidateRun?.runId ?? null,
      status: releaseCandidateRun?.status ?? null,
      conclusion: releaseCandidateRun?.conclusion ?? null,
      workflowStatus: releaseCandidateRun?.workflowStatus ?? null,
      latestRun: releaseCandidateRun,
      manifest: status.releaseCandidate.manifest,
      manifestStatus: status.releaseCandidate.manifestStatus,
      manifestArtifact: status.releaseCandidate.manifestArtifact,
      manifestError: status.releaseCandidate.manifestError,
    },
    staging: {
      currentImages: stagingCurrentImages,
      currentImagesError: status.stagingCurrentImages.error,
      verification: stagingState,
      verificationError: status.stagingVerification.error,
    },
    production: {
      lastDeploy: productionDeployRun,
      currentImages: productionCurrentImages,
      currentImagesError: status.productionDeploy.currentStateError,
    },
    promotionBlockers: blockerGroups.promotionBlockers,
    productionBlockers: blockerGroups.productionBlockers,
    blockers,
  };
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

function summarizeRequiredChecks(checkRuns) {
  const latestByName = new Map();
  for (const checkRun of checkRuns) {
    latestByName.set(checkRun.name, checkRun);
  }

  return ['CI Success', OPENPATH_PRERELEASE_APT_REQUIRED_CHECK].map((name) => {
    const checkRun = latestByName.get(name);
    return {
      name,
      status: checkRun?.status === 'completed' ? (checkRun.conclusion ?? 'unknown') : 'pending',
      detailsUrl: checkRun?.details_url ?? checkRun?.html_url ?? null,
    };
  });
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
  };
}

function readRemoteState({ runCommand, env, access, fileName }) {
  if (!access.key || (!env.RELEASE_STATUS_TEST_MODE && !existsSync(access.key))) {
    return {
      ok: false,
      state: null,
      error: `SSH key not available for read-only ${fileName} read`,
    };
  }

  const remoteCommand = `test -f ${STATE_DIR}/${fileName} && cat ${STATE_DIR}/${fileName}`;
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

export async function buildReleaseStatus({
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
      requiredChecks: checkRuns.ok ? summarizeRequiredChecks(checkRuns.value) : [],
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
  };

  const blockerGroups = deriveReleaseBlockerGroups(status);
  const blockers = isProductionCurrentAtTarget(status)
    ? [...blockerGroups.productionBlockers]
    : [...blockerGroups.promotionBlockers, ...blockerGroups.productionBlockers];
  return {
    ...status,
    ...blockerGroups,
    blockers,
    ...buildReleaseStatusJson({ ...status, ...blockerGroups, blockers }),
  };
}

function formatCheck(check) {
  return `  - ${check.name}: ${check.status}`;
}

export function renderReleaseStatusText(status) {
  const stagingState = status.stagingVerification.state ?? {};
  const productionState = status.productionDeploy.currentState ?? {};
  const lines = [
    'Local release status',
    '',
    'ClassroomPath:',
    `  HEAD: ${shortSha(status.classroomPath.headSha)}`,
    `  origin/main: ${shortSha(status.classroomPath.originMainSha)}`,
    '',
    'OpenPath:',
    `  submodule SHA: ${shortSha(status.openPath.submoduleSha)}`,
    '',
    'Release candidate manifest:',
    `  run: ${valueOrNA(status.releaseCandidate.latestRun?.databaseId)}`,
    `  artifact: ${valueOrNA(status.releaseCandidate.manifestArtifact)}`,
    `  status: ${valueOrNA(status.releaseCandidate.manifestStatus)}`,
    `  app_sha: ${shortSha(status.releaseCandidate.manifest?.app_sha)}`,
    `  openpath_version: ${valueOrNA(status.releaseCandidate.manifest?.openpath_version)}`,
    `  linux_agent_version: ${valueOrNA(status.releaseCandidate.manifest?.linux_agent_version)}`,
    `Prerelease APT pin: ${valueOrNA(status.prereleaseApt.pin)}`,
    '',
    'OpenPath required checks:',
    ...(status.openPath.requiredChecks.length > 0
      ? status.openPath.requiredChecks.map(formatCheck)
      : [`  unavailable: ${valueOrNA(status.openPath.requiredChecksError)}`]),
    '',
    'Staging verification state:',
    `  app_sha: ${shortSha(stagingState.STAGING_VERIFIED_APP_SHA)}`,
    `  openpath_sha: ${shortSha(stagingState.STAGING_VERIFIED_OPENPATH_SHA)}`,
    `  image_source: ${valueOrNA(stagingState.STAGING_VERIFIED_IMAGE_SOURCE)}`,
    `  smoke: ${valueOrNA(stagingState.STAGING_SMOKE_RESULT ?? stagingState.STAGING_SMOKE_STATUS)}`,
    `  release_gate: ${valueOrNA(stagingState.STAGING_RELEASE_GATE_RESULT)}`,
    `  prepromotion_rehearsal: ${valueOrNA(stagingState.STAGING_PREPROMOTION_REHEARSAL_RESULT)}`,
    status.stagingVerification.error ? `  note: ${status.stagingVerification.error}` : '',
    '',
    'Last production deploy:',
    `  run: ${valueOrNA(status.productionDeploy.latestRun?.databaseId)}`,
    `  sha: ${shortSha(status.productionDeploy.latestRun?.headSha)}`,
    `  status: ${valueOrNA(status.productionDeploy.latestRun?.status)}`,
    `  conclusion: ${valueOrNA(status.productionDeploy.latestRun?.conclusion)}`,
    `  updated_at: ${valueOrNA(status.productionDeploy.latestRun?.updatedAt)}`,
    `  current_app_sha: ${shortSha(productionState.APP_SHA)}`,
    status.productionDeploy.currentStateError
      ? `  note: ${status.productionDeploy.currentStateError}`
      : '',
    '',
    'Promotion blockers:',
    ...(status.promotionBlockers?.length
      ? status.promotionBlockers.map((blocker) => `  - ${blocker}`)
      : ['  - none']),
    '',
    'Production blockers:',
    ...(status.productionBlockers?.length
      ? status.productionBlockers.map((blocker) => `  - ${blocker}`)
      : ['  - none']),
  ];

  return `${lines.filter((line) => line !== '').join('\n')}\n`;
}

async function main() {
  const args = parseReleaseStatusArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const status = await buildReleaseStatus({ argv: process.argv.slice(2) });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderReleaseStatusText(status));
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
