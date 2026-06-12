#!/usr/bin/env node

/**
 * Library: implements the pre-promotion Windows runner rehearsal sequence and readiness evaluation logic.
 *
 * Invoked by: Imported by `scripts/prepromotion-runner-rehearsal.mjs`; tested by `prepromotion-runner-rehearsal.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN, WINDOWS_RUNNER_LABEL.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  classifyPrepromotionRequirement,
  readStagingVerificationEnv,
} from './lib/prepromotion-runner-rehearsal.mjs';

const DEFAULT_ENVIRONMENT = 'staging';
const LINUX_REHEARSAL_LANE = {
  id: 'classroompath-linux-ajax-gh',
  command: 'scripts/validate-hypothesis.sh classroompath linux-ajax-gh --integration',
};
const WINDOWS_REHEARSAL_LANE = {
  id: 'classroompath-windows-ajax-direct',
  command: 'scripts/validate-hypothesis.sh classroompath windows-ajax-direct',
};
const REHEARSAL_RISK_RULES = [
  { pattern: /^linux\//, surface: 'linux-bootstrap', lane: LINUX_REHEARSAL_LANE },
  { pattern: /^windows\//, surface: 'windows-native-host', lane: WINDOWS_REHEARSAL_LANE },
  { pattern: /^firefox-extension\//, surface: 'firefox-extension', lane: WINDOWS_REHEARSAL_LANE },
  { pattern: /^tests\/e2e\//, surface: 'browser-e2e', lane: WINDOWS_REHEARSAL_LANE },
  {
    pattern: /^scripts\/run-windows-runner-direct\.mjs$/,
    surface: 'windows-runner-direct',
    lane: WINDOWS_REHEARSAL_LANE,
  },
  {
    pattern: /^package(?:-lock)?\.json$/,
    surface: 'node-dependencies',
    lane: WINDOWS_REHEARSAL_LANE,
  },
];

function printUsage() {
  console.error(`Usage:
  node scripts/prepromotion-runner-rehearsal.mjs <plan|verify|run> --staging-verification <path> [options]

Options:
  --staging-verification <path>  Required staging-verification.env evidence
  --artifact-dir <path>          Evidence directory for the direct runner artifact
  --artifact-path <path>         Existing direct runner artifact path for verify/plan
  --changed-files <path>         Newline-delimited OpenPath changed files for selective plan
  --target-sha <sha>             ClassroomPath target SHA for selective plan output
  --environment <name>           staging | production (default: ${DEFAULT_ENVIRONMENT})
  --base-url <url>               Public ClassroomPath URL override
  --openpath-root <path>         Local OpenPath checkout for the direct runner
  --confirm-production           Required when --environment production
`);
}

function nextArg(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
  return value;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    stagingVerification: '',
    artifactDir: '',
    artifactPath: '',
    changedFiles: '',
    targetSha: 'HEAD',
    environment: DEFAULT_ENVIRONMENT,
    baseUrl: '',
    openpathRoot: '',
    confirmProduction: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--staging-verification') {
      options.stagingVerification = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--artifact-dir') {
      options.artifactDir = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--artifact-path') {
      options.artifactPath = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--changed-files') {
      options.changedFiles = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--target-sha') {
      options.targetSha = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--environment') {
      options.environment = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--base-url') {
      options.baseUrl = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--openpath-root') {
      options.openpathRoot = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--confirm-production') {
      options.confirmProduction = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveArtifactDir(options) {
  return (
    options.artifactDir ||
    resolve('.opencode/tmp/prepromotion-windows-ajax', `${options.environment}-${Date.now()}`)
  );
}

function normalizeResolvedPaths(options) {
  const artifactDir = resolveArtifactDir(options);
  options.artifactDir = artifactDir;
  if (!options.artifactPath) {
    options.artifactPath = resolve(artifactDir, 'production-windows-ajax-auto-allow-canary.json');
  }
  return options;
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@=+-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\''`)}'`;
}

function resolveArtifactPath(options) {
  return (
    options.artifactPath ||
    resolve(resolveArtifactDir(options), 'production-windows-ajax-auto-allow-canary.json')
  );
}

function buildDirectRunnerCommand(options) {
  const command = [
    'npm',
    'run',
    'diagnostics:windows-ajax:direct',
    '--',
    '--environment',
    options.environment,
  ];
  command.push('--artifact-dir', resolveArtifactDir(options));
  if (options.baseUrl) command.push('--base-url', options.baseUrl);
  if (options.openpathRoot) command.push('--openpath-root', options.openpathRoot);
  if (options.environment === 'production') command.push('--confirm-production');
  return command;
}

function readChangedFiles(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function planPrepromotionRunnerRehearsal({ changedFiles, targetSha = 'HEAD' }) {
  const riskSurfaces = [];
  const lanesById = new Map();

  for (const file of changedFiles) {
    for (const rule of REHEARSAL_RISK_RULES) {
      if (!rule.pattern.test(file)) continue;
      riskSurfaces.push({ file, surface: rule.surface });
      lanesById.set(rule.lane.id, rule.lane);
      break;
    }
  }

  const lanes = [...lanesById.values()];
  const required = lanes.length > 0;
  return {
    targetSha,
    required,
    riskSurfaces,
    lanes,
    reason: required
      ? 'OpenPath platform-sensitive files changed'
      : 'no OpenPath platform-sensitive files changed',
  };
}

function printSelectivePlan(plan) {
  console.log(`Prepromotion runner rehearsal plan for ${plan.targetSha}`);
  console.log('OpenPath changed risk surfaces:');
  if (plan.riskSurfaces.length === 0) {
    console.log('  - (none)');
  } else {
    for (const surface of plan.riskSurfaces) {
      console.log(`  - ${surface.file} -> ${surface.surface}`);
    }
  }

  console.log('Recommended lanes:');
  if (plan.lanes.length === 0) {
    console.log('  - (none)');
  } else {
    for (const lane of plan.lanes) {
      console.log(`  - ${lane.command}`);
    }
  }
  console.log(`Required before promotion: ${plan.required ? 'yes' : 'no'}`);
  if (!plan.required) {
    console.log(`Reason: ${plan.reason}`);
  }
}

function printResult(result) {
  console.log(`state=${result.state}`);
  console.log(`reason=${result.reason}`);
  console.log(`artifact_path=${result.artifactPath ?? ''}`);
  console.log(`missing_hosts=${result.missingHosts.join(',')}`);
}

function loadRequirement(options) {
  if (!options.stagingVerification) throw new Error('--staging-verification is required');
  if (!existsSync(options.stagingVerification)) {
    throw new Error(`Staging verification file not found: ${options.stagingVerification}`);
  }
  return classifyPrepromotionRequirement({
    stagingVerification: readStagingVerificationEnv(options.stagingVerification),
    artifactPath: resolveArtifactPath(options),
  });
}

function main() {
  let options;
  try {
    options = normalizeResolvedPaths(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  if (!['plan', 'verify', 'run'].includes(options.command)) {
    console.error(`Unsupported command: ${options.command ?? '(none)'}`);
    printUsage();
    process.exit(1);
  }
  if (!['staging', 'production'].includes(options.environment)) {
    console.error(`Unsupported environment: ${options.environment}`);
    process.exit(1);
  }
  if (options.environment === 'production' && !options.confirmProduction) {
    console.error('Production prepromotion rehearsal requires --confirm-production.');
    process.exit(1);
  }

  if (options.command === 'plan' && options.changedFiles) {
    printSelectivePlan(
      planPrepromotionRunnerRehearsal({
        changedFiles: readChangedFiles(options.changedFiles),
        targetSha: options.targetSha,
      })
    );
    process.exit(0);
  }

  const result = loadRequirement(options);
  printResult(result);

  if (options.command === 'plan') {
    if (result.state === 'required') {
      console.log(`command=${buildDirectRunnerCommand(options).map(shellQuote).join(' ')}`);
    }
    process.exit(result.state === 'failed' ? 1 : 0);
  }

  if (options.command === 'verify') {
    process.exit(result.state === 'passed' || result.state === 'not_required' ? 0 : 1);
  }

  if (result.state === 'passed' || result.state === 'not_required') return;
  if (result.state === 'failed') process.exit(1);

  const command = buildDirectRunnerCommand(options);
  const runResult = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (runResult.status !== 0) process.exit(runResult.status ?? 1);

  const finalResult = loadRequirement(options);
  printResult(finalResult);
  process.exit(finalResult.state === 'passed' ? 0 : 1);
}

main();
