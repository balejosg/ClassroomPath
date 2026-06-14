#!/usr/bin/env node
// @ts-check

/**
 * CLI entry point that collects and displays read-only local promotion status for the current ClassroomPath checkout.
 *
 * Invoked by: `npm run release:status` (`node scripts/release-status.mjs`).
 * Usage: node scripts/release-status.mjs [--sha <classroompath-sha>] [--openpath-sha <sha>] [--json]
 * Also exports `buildReleaseStatus`, `buildReleaseStatusJson`, and related helpers used by
 * `scripts/lib/release-preflight.mjs`; tested by `tests/release-status.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution } from './lib/github-actions.mjs';
import {
  collectReleaseStatusEvidence,
  detectOperationalTargetPlaceholders,
  resolveNextPatchTagFromRemoteTags,
} from './lib/release-status-collector.mjs';
import {
  deriveBlockerDetails,
  deriveReleaseBlockerGroups as evaluateReleaseBlockerGroups,
  deriveReleaseBlockers as evaluateReleaseBlockers,
  isProductionCurrentAtTarget as evaluateProductionCurrentAtTarget,
} from './lib/release-status-evaluator.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

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

function shortSha(value) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 12) : 'n/a';
}

function valueOrNA(value) {
  const text = String(value ?? '').trim();
  return text || 'n/a';
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

export {
  detectOperationalTargetPlaceholders,
  evaluateReleaseBlockerGroups as deriveReleaseBlockerGroups,
  evaluateReleaseBlockers as deriveReleaseBlockers,
  resolveNextPatchTagFromRemoteTags,
};

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
      : evaluateReleaseBlockerGroups(status);
  const blockers =
    status.blockers ??
    (evaluateProductionCurrentAtTarget(status)
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
    release: {
      nextTag: status.release?.nextTag ?? '',
    },
    operationalTargets: status.operationalTargets ?? {
      placeholders: [],
    },
    promotionBlockers: blockerGroups.promotionBlockers,
    productionBlockers: blockerGroups.productionBlockers,
    blockers,
  };
}

export async function buildReleaseStatus({
  argv = [],
  env = process.env,
  runCommand = defaultRunCommand,
} = {}) {
  const status = await collectReleaseStatusEvidence({ argv, env, runCommand });
  const blockerGroups = evaluateReleaseBlockerGroups(status);
  const blockers = evaluateProductionCurrentAtTarget(status)
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
    'Local release status (advisory snapshot — authoritative gate: `npm run verify:promotion-ready`, live SSH)',
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
      ? (() => {
          const details = deriveBlockerDetails(status);
          return status.promotionBlockers.map((blocker) => {
            const detail = details[blocker];
            return detail ? `  - ${blocker}: ${detail}` : `  - ${blocker}`;
          });
        })()
      : ['  - none']),
    '',
    'Production blockers:',
    ...(status.productionBlockers?.length
      ? (() => {
          const details = deriveBlockerDetails(status);
          return status.productionBlockers.map((blocker) => {
            const detail = details[blocker];
            return detail ? `  - ${blocker}: ${detail}` : `  - ${blocker}`;
          });
        })()
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
