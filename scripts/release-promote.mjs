#!/usr/bin/env node

import { isDirectExecution } from './lib/github-actions.mjs';
import {
  buildPromotionPlan,
  formatCommand,
  runStep,
  summarizeGitHubRunMonitor,
} from './lib/release-orchestration.mjs';

function usage() {
  return `Usage: npm run release:promote -- --tag <vX.Y.Z> [--execute|--dry-run] [--high-risk-windows|--no-high-risk-windows] [--post-production-windows-canary|--no-post-production-windows-canary]

Builds and runs the production promotion plan.

Options:
  --tag <tag>                         Production tag to create, for example v1.2.301.
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

    validateTag(options.tag);

    const plan = buildPromotionPlan({
      tag: options.tag,
      highRiskWindows: options.highRiskWindows,
      postProductionWindowsCanary: options.postProductionWindowsCanary,
    });

    if (options.dryRun || !options.execute) {
      printPlan(plan, io);
      return { status: 0 };
    }

    const results = [];
    for (const planStep of plan.steps) {
      if (!planStep.command) {
        printSummary(plan, results, io);
        continue;
      }

      io.stdout(`\n==> ${planStep.id}\n${formatCommand(planStep.command)}\n`);
      const result = await (dependencies.runStep ?? runStep)(planStep);
      results.push(result);
      if (result.githubRun) {
        io.stdout(`${summarizeGitHubRunMonitor(result.githubRun)}\n`);
      }
      if (result.status !== 'success') {
        io.stderr(`Step failed: ${result.id}\n`);
        return { status: 1, results };
      }
    }

    return { status: 0, results };
  } catch (error) {
    io.stderr(`${error.message}\n\n${usage()}`);
    return { status: 2 };
  }
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
