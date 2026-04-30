#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  classifyPrepromotionRequirement,
  readStagingVerificationEnv,
} from './lib/prepromotion-runner-rehearsal.mjs';

const DEFAULT_ENVIRONMENT = 'staging';

function printUsage() {
  console.error(`Usage:
  node scripts/prepromotion-runner-rehearsal.mjs <plan|verify|run> --staging-verification <path> [options]

Options:
  --staging-verification <path>  Required staging-verification.env evidence
  --artifact-dir <path>          Evidence directory for the direct runner artifact
  --artifact-path <path>         Existing direct runner artifact path for verify/plan
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
