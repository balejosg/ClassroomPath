#!/usr/bin/env node

/**
 * Orchestrates the full production promotion sequence: evidence validation, deploy, health check, and post-release canary.
 *
 * Invoked by: Developer CLI via `npm run release:promote`.
 * Usage: node scripts/release-promote.mjs [--auto-tag] [--dry-run]
 * Env: GITHUB_TOKEN, RELEASE_EVIDENCE_PATH.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { isDirectExecution } from './lib/github-actions.mjs';
import { rerunGitHubRunFailedJobs as defaultRerunGitHubRunFailedJobs } from './lib/github-actions-artifacts.mjs';
import {
  buildPromotionPlan,
  formatCommand,
  readReleaseBundleLocatorIdentity,
  readStepState,
  runStep,
  summarizeGitHubRunMonitor,
  writeStepState,
} from './lib/release-orchestration.mjs';
import { buildReleaseTranscript, writeReleaseTranscript } from './lib/release-transcript.mjs';

const execFile = promisify(nodeExecFile);

function usage() {
  return `Usage: npm run release:promote -- (--tag <vX.Y.Z>|--auto-tag) [--execute|--dry-run] [--high-risk-windows|--no-high-risk-windows] [--post-production-windows-canary|--no-post-production-windows-canary] [--from-step <id>|--only <id>|--resume]

Builds and runs the production promotion plan.

Options:
  --tag <tag>                         Production tag to create, for example v1.2.301.
  --auto-tag                          Use the next patch tag after the highest remote vX.Y.Z tag.
  --dry-run                           Print the ordered plan without running commands. Default.
  --execute                           Run the ordered plan. This can deploy staging and create/push the production tag.
  --high-risk-windows                 Include Windows prepromotion evidence step. Default.
  --no-high-risk-windows              Omit Windows prepromotion evidence step.
  --post-production-windows-canary    Include the post-production Windows canary step. Default.
  --no-post-production-windows-canary Omit the post-production Windows canary step for emergency opt-out.
  --from-step <id>                    Skip all steps before <id> and run from <id> to the end.
                                      Rejected if any skipped promotion gate has not already passed
                                      (i.e. is not recorded 'success' in the state file for this tag).
                                      The verify-promotion-identity gate always runs.
  --only <id>                         Run only this step. May be repeated to build a set of steps
                                      (e.g. --only verify-promotion-ready --only release-preflight).
                                      Subject to the same promotion-gate guard as --from-step; the
                                      verify-promotion-identity gate always runs.
  --resume                            Read the persisted state file for this tag and skip every step
                                      already recorded 'success'. Promotion-gate guard still applies;
                                      verify-promotion-identity always runs.
  --help                              Show this help.
`;
}

export function parseReleasePromoteArgs(argv) {
  const options = {
    tag: '',
    autoTag: false,
    dryRun: true,
    execute: false,
    highRiskWindows: true,
    postProductionWindowsCanary: true,
    help: false,
    fromStep: null,
    only: [],
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--tag':
        options.tag = requireNextValue(argv, ++index, '--tag');
        break;
      case '--auto-tag':
        options.autoTag = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        options.execute = false;
        break;
      case '--execute':
        options.execute = true;
        options.dryRun = false;
        break;
      case '--high-risk-windows':
        options.highRiskWindows = true;
        break;
      case '--no-high-risk-windows':
        options.highRiskWindows = false;
        break;
      case '--post-production-windows-canary':
        options.postProductionWindowsCanary = true;
        break;
      case '--no-post-production-windows-canary':
        options.postProductionWindowsCanary = false;
        break;
      case '--from-step':
        options.fromStep = requireNextValue(argv, ++index, '--from-step');
        break;
      case '--only':
        options.only.push(requireNextValue(argv, ++index, '--only'));
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export async function runReleasePromoteCommand(argv = process.argv.slice(2), dependencies = {}) {
  const io = {
    stdout: dependencies.stdout ?? ((value) => process.stdout.write(value)),
    stderr: dependencies.stderr ?? ((value) => process.stderr.write(value)),
  };

  try {
    const options = parseReleasePromoteArgs(argv);
    if (options.help) {
      io.stdout(usage());
      return { status: 0 };
    }

    if (options.autoTag && options.tag) {
      throw new Error('--auto-tag cannot be combined with --tag');
    }

    const tag = options.autoTag
      ? await resolveNextPatchTag({ execFile: dependencies.execFile ?? execFile })
      : options.tag;

    validateTag(tag);

    const transcriptRoot = dependencies.transcriptRoot;
    const plan = buildPromotionPlan({
      tag,
      highRiskWindows: options.highRiskWindows,
      postProductionWindowsCanary: options.postProductionWindowsCanary,
      transcriptRoot,
    });

    const readStepStateFn = dependencies.readStepState ?? readStepState;
    const persistedState = readStepStateFn({ root: transcriptRoot, tag });
    const locatorIdentity = readReleaseBundleLocatorIdentity(plan.releaseBundleStateFile);
    assertPromotionResumeIdentity({
      state: persistedState,
      locator: locatorIdentity,
    });

    // --- Step filtering (--from-step / --only / --resume) ---
    const { skipSet, skipReasons } = resolveSkipSet({
      plan,
      options,
      stateRoot: dependencies.transcriptRoot,
      tag,
      readStepStateFn,
    });

    if (options.dryRun || !options.execute) {
      printPlan(plan, io, skipSet, skipReasons);
      return { status: 0 };
    }

    const results = [];
    const retries = [];
    const reruns = [];
    const startedAt = new Date().toISOString();
    const executeStep = async (planStep, extra = {}) => {
      io.stdout(`\n==> ${planStep.id}\n${formatCommand(planStep.command)}\n`);
      const result = await (dependencies.runStep ?? runStep)(planStep);
      const recorded = {
        ...result,
        command: formatCommand(planStep.command),
        retryOf: extra.retryOf ?? null,
      };
      results.push(recorded);
      if (recorded.githubRun) {
        io.stdout(`${summarizeGitHubRunMonitor(recorded.githubRun)}\n`);
      }
      const currentLocator = readReleaseBundleLocatorIdentity(plan.releaseBundleStateFile);
      // Persist step outcome so --resume can skip it on the next run.
      (dependencies.writeStepState ?? writeStepState)({
        root: dependencies.transcriptRoot,
        tag,
        releaseId: currentLocator?.releaseId,
        classroomPathSha: currentLocator?.classroomPathSha,
        openpathSha: currentLocator?.openpathSha,
        openpathContractSha256: currentLocator?.openpathContractSha256,
        rcRunId: currentLocator?.rcRunId,
        startedAt,
        stepId: recorded.id,
        status: recorded.status,
        seconds: recorded.seconds,
      });
      return recorded;
    };

    for (const planStep of plan.steps) {
      if (!planStep.command) {
        printSummary(plan, results, io);
        continue;
      }

      // Skip steps excluded by --from-step / --only / --resume.
      if (skipSet.has(planStep.id)) {
        const reason = skipReasons.get(planStep.id) ?? 'skipped';
        io.stdout(`\n==> ${planStep.id} [${reason}]\n`);
        continue;
      }

      let result = await executeStep(planStep);
      if (planStep.id === 'wait-production-deploy') {
        attachProductionDeployRun(result);
      }

      if (
        planStep.id === 'run-post-production-windows-canary' &&
        result.status === 'success' &&
        String(result.stdout ?? '').includes('POST_PRODUCTION_WINDOWS_CANARY_SKIPPED=token-absent')
      ) {
        io.stdout(
          'run-post-production-windows-canary skipped (CI-only CP_CLIENT_CANARY_ADMIN_TOKEN absent; deploy.yml production Windows canaries cover it)\n'
        );
      }

      if (
        result.status !== 'success' &&
        planStep.id === 'verify-promotion-ready' &&
        shouldRefreshWindowsPrepromotionEvidence(result)
      ) {
        const evidenceStep = buildWindowsPrepromotionEvidenceStep();
        retries.push({
          step: planStep.id,
          retryStep: evidenceStep.id,
          reason: 'missing-or-stale-windows-prepromotion-evidence',
        });
        const evidenceResult = await executeStep(evidenceStep);
        if (evidenceResult.status !== 'success') {
          io.stderr(
            'Windows prepromotion evidence refresh failed; check real deploy target/canary config for placeholders.\n'
          );
          writeTranscriptIfRequested({
            dependencies,
            tag,
            status: 'failed',
            startedAt,
            results,
            retries,
            reruns,
          });
          return { status: 1, results, retries, reruns };
        }
        result = await executeStep(planStep, { retryOf: planStep.id });
      }

      if (
        result.status !== 'success' &&
        planStep.id === 'wait-production-deploy' &&
        (await enrichFailedProductionDeploy({ result, tag, dependencies, executeStep })) &&
        shouldRerunProductionDeploy(result)
      ) {
        const runId = result.githubRun?.runId;
        const repo = result.githubRun?.repo ?? 'balejosg/ClassroomPath';
        reruns.push({ step: planStep.id, runId, repo });
        await (dependencies.rerunGitHubRunFailedJobs ?? defaultRerunGitHubRunFailedJobs)({
          repo,
          runId,
        });
        result = await executeStep(planStep, { retryOf: planStep.id });
        attachProductionDeployRun(result);
      }

      if (result.status !== 'success') {
        io.stderr(`Step failed: ${result.id}\n`);
        writeTranscriptIfRequested({
          dependencies,
          tag,
          status: 'failed',
          startedAt,
          results,
          retries,
          reruns,
        });
        return { status: 1, results, retries, reruns };
      }
    }

    writeTranscriptIfRequested({
      dependencies,
      tag,
      status: 'success',
      startedAt,
      results,
      retries,
      reruns,
    });
    return { status: 0, results, retries, reruns };
  } catch (error) {
    io.stderr(`${error.message}\n\n${usage()}`);
    return { status: 2 };
  }
}

// Step ids that are mandatory pre-promotion safety gates.
// Skipping any of these without a 'success' record in the state file is fatal.
const PROMOTION_GATE_IDS = new Set([
  'verify-clean-repos',
  'verify-promotion-ready',
  'verify-production-target-ready',
  'release-preflight',
]);

/**
 * Compute the skip set and skip reasons for the current run based on --from-step / --only / --resume.
 *
 * Throws (fail-closed) if any promotion gate would be skipped without a prior 'success' record.
 *
 * Returns { skipSet: Set<string>, skipReasons: Map<string, string> }.
 *
 * @param {object} params
 * @param {object} params.plan
 * @param {object} params.options - parsed CLI options
 * @param {string|undefined} params.stateRoot - transcriptRoot for state files
 * @param {string} params.tag
 * @param {Function} params.readStepStateFn - injected readStepState (for tests)
 */
function resolveSkipSet({ plan, options, stateRoot, tag, readStepStateFn }) {
  const allIds = plan.steps.map((s) => s.id);
  const skipSet = new Set();
  const skipReasons = new Map();

  // The three step-selection flags are mutually exclusive; combining them is ambiguous.
  const selectionFlags = [
    options.fromStep !== null ? '--from-step' : null,
    options.only.length > 0 ? '--only' : null,
    options.resume ? '--resume' : null,
  ].filter(Boolean);
  if (selectionFlags.length > 1) {
    throw new Error(
      `--from-step, --only, and --resume are mutually exclusive (got ${selectionFlags.join(', ')}).`
    );
  }

  // Validate that any id supplied to --from-step / --only exists in the plan.
  if (options.fromStep !== null) {
    if (!allIds.includes(options.fromStep)) {
      throw new Error(
        `--from-step '${options.fromStep}' is not a valid step id. Valid ids: ${allIds.join(', ')}`
      );
    }
  }
  for (const id of options.only) {
    if (!allIds.includes(id)) {
      throw new Error(`--only '${id}' is not a valid step id. Valid ids: ${allIds.join(', ')}`);
    }
  }

  // Build the raw skip set from the flags.
  if (options.fromStep !== null) {
    const cutoff = allIds.indexOf(options.fromStep);
    for (let i = 0; i < cutoff; i += 1) {
      skipSet.add(allIds[i]);
      skipReasons.set(allIds[i], `skipped: before --from-step ${options.fromStep}`);
    }
  } else if (options.only.length > 0) {
    const onlySet = new Set(options.only);
    for (const id of allIds) {
      if (!onlySet.has(id)) {
        skipSet.add(id);
        skipReasons.set(id, `skipped: not in --only set`);
      }
    }
  } else if (options.resume) {
    const state = readStepStateFn({ root: stateRoot, tag });
    for (const id of allIds) {
      if ((state?.steps?.[id]?.status ?? '') === 'success') {
        skipSet.add(id);
        skipReasons.set(id, `skipped: recorded success`);
      }
    }
  }

  // This gate is deliberately never skipped. It compares the live target refs and the
  // persisted bundle bytes even when --resume, --from-step, or --only would otherwise skip it.
  const identityGateId = 'verify-promotion-identity';
  skipSet.delete(identityGateId);
  skipReasons.delete(identityGateId);

  // Fail-closed guard: reject any skip of an un-passed promotion gate, regardless of which
  // flag built the skip set. Gates added by --resume are present only when already recorded
  // success, so they re-confirm here; gates added by --from-step / --only are checked against
  // the persisted state. Reading state unconditionally keeps the guard sound even if the
  // selection flags are somehow combined.
  if (skipSet.size > 0) {
    const state = readStepStateFn({ root: stateRoot, tag });
    const blockedGates = [];
    for (const id of skipSet) {
      if (PROMOTION_GATE_IDS.has(id) && (state?.steps?.[id]?.status ?? '') !== 'success') {
        blockedGates.push(id);
      }
    }

    if (blockedGates.length > 0) {
      throw new Error(
        `Refusing to skip un-passed promotion gate(s): ${blockedGates.join(', ')}. ` +
          `Re-run without --from-step/--only, or use --resume after they have passed.`
      );
    }
  }

  return { skipSet, skipReasons };
}

function assertPromotionResumeIdentity({ state, locator }) {
  const stateReleaseId = normalizePromotionReleaseId(state?.releaseId, 'persisted releaseId');
  const stateClassroomPathSha = normalizePromotionSha40(
    state?.classroomPathSha,
    'persisted classroomPathSha'
  );
  const stateOpenpathSha = normalizePromotionSha40(state?.openpathSha, 'persisted openpathSha');
  const stateOpenpathContractSha256 = normalizePromotionSha256(
    state?.openpathContractSha256,
    'persisted openpathContractSha256'
  );
  const stateRcRunId = normalizePromotionRcRunId(state?.rcRunId, 'persisted rcRunId');
  const stateIdentity = [
    stateReleaseId,
    stateClassroomPathSha,
    stateOpenpathSha,
    stateOpenpathContractSha256,
    stateRcRunId,
  ];
  const hasStateIdentity = stateIdentity.some(Boolean);

  if (hasStateIdentity && stateIdentity.some((value) => !value)) {
    throw new Error(
      'Promotion state contains an incomplete Release Bundle identity; refusing resume or selective skip'
    );
  }

  if (hasStateIdentity && !locator) {
    throw new Error(
      'Promotion state contains Release Bundle identity but the exact Release Bundle locator is missing'
    );
  }

  if (stateReleaseId && stateReleaseId !== locator.releaseId) {
    throw new Error(
      `Promotion state is bound to a different Release Bundle releaseId: ${stateReleaseId} != ${locator.releaseId}`
    );
  }

  if (stateClassroomPathSha && stateClassroomPathSha !== locator.classroomPathSha) {
    throw new Error(
      `Promotion state is bound to a different ClassroomPath SHA: ${stateClassroomPathSha} != ${locator.classroomPathSha}`
    );
  }

  if (stateOpenpathSha && stateOpenpathSha !== locator.openpathSha) {
    throw new Error(
      `Promotion state is bound to a different OpenPath SHA: ${stateOpenpathSha} != ${locator.openpathSha}`
    );
  }

  if (
    stateOpenpathContractSha256 &&
    stateOpenpathContractSha256 !== locator.openpathContractSha256
  ) {
    throw new Error(
      `Promotion state is bound to a different OpenPath contract SHA-256: ${stateOpenpathContractSha256} != ${locator.openpathContractSha256}`
    );
  }

  if (stateRcRunId && stateRcRunId !== locator.rcRunId) {
    throw new Error(
      `Promotion state is bound to a different Release Bundle rcRunId: ${stateRcRunId} != ${locator.rcRunId}`
    );
  }
}

function normalizePromotionReleaseId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

function normalizePromotionRcRunId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a numeric GitHub run id`);
  }
  return normalized;
}

function normalizePromotionSha40(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 40-character lowercase SHA`);
  }
  return normalized;
}

function normalizePromotionSha256(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

function buildWindowsPrepromotionEvidenceStep() {
  return {
    id: 'ensure-windows-prepromotion-evidence',
    command: ['node', 'scripts/prepromotion-windows-evidence.mjs', 'run-and-persist'],
    description: 'Run and persist required Windows prepromotion evidence.',
  };
}

function shouldRefreshWindowsPrepromotionEvidence(result) {
  const text = [result.stderr, result.stdout, result.message, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return (
    text.includes('windows-prepromotion-evidence-missing') ||
    text.includes('windows-prepromotion-evidence-stale') ||
    text.includes('prepromotion windows evidence') ||
    text.includes('windows prepromotion evidence') ||
    text.includes('preproduction installed-client evidence')
  );
}

function shouldRerunProductionDeploy(result) {
  const runId = result.githubRun?.runId;
  if (!runId) {
    return false;
  }

  const safeToRetry = String(result.deployBrief?.failureBoundary?.safeToRetry ?? '').toLowerCase();
  const nextCommand = String(result.deployBrief?.nextCommand ?? '').toLowerCase();
  const recommendedAction = String(result.githubRun?.recommendedAction ?? '').toLowerCase();
  const state = String(result.githubRun?.state ?? '').toLowerCase();
  const failedJobs = result.githubRun?.failedJobs ?? [];
  const failedText = failedJobs.map((job) => `${job.name ?? ''} ${job.conclusion ?? ''}`).join(' ');

  return (
    safeToRetry === 'yes' ||
    safeToRetry === 'after-cleanup' ||
    recommendedAction === 'rerun-workflow' ||
    state === 'corrupt' ||
    nextCommand.includes(`gh run rerun ${runId}`) ||
    /\b(ghcr|timeout|timed out|network|runner|apt|rate limit|502|503|504)\b/i.test(failedText)
  );
}

async function enrichFailedProductionDeploy({ result, tag, dependencies, executeStep }) {
  if (!result.githubRun?.runId) {
    return false;
  }
  if (result.deployBrief) {
    return true;
  }

  const runId = result.githubRun.runId;
  const outputDir = join(
    dependencies.transcriptRoot ?? '.opencode/tmp/release-promote',
    tag,
    'deploy-brief'
  );
  const briefStep = {
    id: 'build-production-deploy-brief',
    command: [
      'npm',
      'run',
      'ops:deploy-brief',
      '--',
      '--run',
      String(runId),
      '--tag',
      tag,
      '--output-dir',
      outputDir,
    ],
    description: 'Generate deploy failure brief for the failed production deploy run.',
  };

  const briefResult = await executeStep(briefStep);
  result.deployBrief =
    parseJsonObjectFromText(briefResult.stdout) ?? readDeployBriefJson(outputDir) ?? null;

  return true;
}

function attachProductionDeployRun(result) {
  if (result.githubRun) {
    return result;
  }

  const stdout = String(result.stdout ?? '');
  const health = parseJsonObjectFromText(stdout) ?? {};
  const foundRunId = stdout.match(/Found production deploy run:\s*(\d+)/)?.[1];
  const runId = String(health.runId ?? health.databaseId ?? foundRunId ?? '').trim();
  if (!runId) {
    return result;
  }

  result.githubRun = {
    repo: 'balejosg/ClassroomPath',
    runId,
    workflow: health.workflowName ?? health.workflow ?? health.name ?? 'Deploy',
    status: health.status ?? 'unknown',
    conclusion: health.conclusion ?? 'unknown',
    state: health.state ?? null,
    recommendedAction: health.recommendedAction ?? null,
    url: health.url ?? null,
    jobs: Array.isArray(health.jobs) ? health.jobs : [],
    failedJobs: Array.isArray(health.failedJobs) ? health.failedJobs : [],
  };
  return result;
}

function readDeployBriefJson(outputDir) {
  try {
    return JSON.parse(readFileSync(join(outputDir, 'deploy-brief.json'), 'utf8'));
  } catch {
    return null;
  }
}

function parseJsonObjectFromText(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) {
      continue;
    }
    try {
      return JSON.parse(lines.slice(index).join('\n'));
    } catch {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Keep scanning older lines.
      }
    }
  }
  return null;
}

function writeTranscriptIfRequested({
  dependencies,
  tag,
  status,
  startedAt,
  results,
  retries,
  reruns,
}) {
  const transcript = buildReleaseTranscript({
    tag,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps: results,
    retries,
    reruns,
  });
  writeReleaseTranscript({
    transcript,
    root: dependencies.transcriptRoot,
  });
}

export async function resolveNextPatchTag({ execFile: runExecFile = execFile } = {}) {
  const result = await runExecFile('git', ['ls-remote', '--tags', '--refs', 'origin', 'v*']);
  const tags = String(result.stdout ?? '')
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
    throw new Error('No remote vX.Y.Z tags found for --auto-tag');
  }

  const latest = tags[0];
  return `v${latest.major}.${latest.minor}.${latest.patch + 1}`;
}

function printPlan(plan, io, skipSet = new Set(), skipReasons = new Map()) {
  io.stdout(`Production promotion plan for ${plan.tag}\n`);
  io.stdout(`mode: dry-run\n`);
  io.stdout(`high_risk_windows: ${plan.highRiskWindows ? 'true' : 'false'}\n\n`);

  plan.steps.forEach((planStep, index) => {
    const skipped = skipSet.has(planStep.id);
    const reason = skipReasons.get(planStep.id) ?? '';
    const status = skipped ? ` [${reason}]` : '';
    io.stdout(`${index + 1}. ${planStep.id}${status}\n`);
    io.stdout(`   ${planStep.description}\n`);
    io.stdout(`   command: ${formatCommand(planStep.command)}\n`);
  });
}

function printSummary(plan, results, io) {
  io.stdout('\nProduction promotion summary\n');
  io.stdout(`tag: ${plan.tag}\n`);
  for (const result of results) {
    io.stdout(`${result.id}: ${result.status} (${result.seconds}s)\n`);
  }
}

function validateTag(tag) {
  if (!tag) {
    throw new Error('--tag is required');
  }

  if (!/^v\d+(?:\.\d+){2,}$/.test(tag)) {
    throw new Error('tag must look like v<major>.<minor>.<patch>');
  }
}

function requireNextValue(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runReleasePromoteCommand();
  process.exitCode = result.status;
}
