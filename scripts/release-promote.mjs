#!/usr/bin/env node

import { execFile as nodeExecFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { isDirectExecution } from './lib/github-actions.mjs';
import { rerunGitHubRunFailedJobs as defaultRerunGitHubRunFailedJobs } from './lib/github-actions-artifacts.mjs';
import {
  buildPromotionPlan,
  formatCommand,
  runStep,
  summarizeGitHubRunMonitor,
} from './lib/release-orchestration.mjs';
import { buildReleaseTranscript, writeReleaseTranscript } from './lib/release-transcript.mjs';

const execFile = promisify(nodeExecFile);

function usage() {
  return `Usage: npm run release:promote -- (--tag <vX.Y.Z>|--auto-tag) [--execute|--dry-run] [--high-risk-windows|--no-high-risk-windows] [--post-production-windows-canary|--no-post-production-windows-canary]

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

    const plan = buildPromotionPlan({
      tag,
      highRiskWindows: options.highRiskWindows,
      postProductionWindowsCanary: options.postProductionWindowsCanary,
    });

    if (options.dryRun || !options.execute) {
      printPlan(plan, io);
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
      return recorded;
    };

    for (const planStep of plan.steps) {
      if (!planStep.command) {
        printSummary(plan, results, io);
        continue;
      }

      let result = await executeStep(planStep);
      if (planStep.id === 'wait-production-deploy') {
        attachProductionDeployRun(result);
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

function printPlan(plan, io) {
  io.stdout(`Production promotion plan for ${plan.tag}\n`);
  io.stdout(`mode: dry-run\n`);
  io.stdout(`high_risk_windows: ${plan.highRiskWindows ? 'true' : 'false'}\n\n`);

  plan.steps.forEach((planStep, index) => {
    io.stdout(`${index + 1}. ${planStep.id}\n`);
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
