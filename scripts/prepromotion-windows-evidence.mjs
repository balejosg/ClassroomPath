#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';

import {
  buildPrepromotionProcessEnv,
  readStagingVerificationFromFile,
  readStagingVerificationFromHost,
  resolveWindowsPrepromotionRequirement,
  runAndPersistWindowsPrepromotionEvidence,
} from './lib/prepromotion-windows-evidence.mjs';

function printUsage() {
  console.error(`Usage:
  node scripts/prepromotion-windows-evidence.mjs inspect [options]
  node scripts/prepromotion-windows-evidence.mjs run-and-persist [options]

Options:
  --staging-verification <path>  Read local staging-verification.env snapshot
  --staging-host <host>          Read staging-verification.env with read-only ssh cat
  --staging-user <user>          SSH user for --staging-host (default: deploy)
  --staging-port <port>          SSH port for --staging-host (default: 22)
  --staging-ssh-key <path>       SSH key for --staging-host (default: STAGING_SSH_KEY)
  --artifact-dir <path>          Directory for Windows AJAX direct canary artifacts
  --openpath-root <path>         Local OpenPath checkout for the direct canary
  --target-sha <sha>             Staged ClassroomPath SHA to validate/persist
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
    stagingHost: '',
    stagingUser: 'deploy',
    stagingPort: '22',
    stagingSshKey: process.env.STAGING_SSH_KEY ?? '',
    artifactDir: '',
    openpathRoot: '../OpenPath',
    targetSha: '',
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--staging-verification') {
      options.stagingVerification = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--staging-host') {
      options.stagingHost = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--staging-user') {
      options.stagingUser = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--staging-port') {
      options.stagingPort = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--staging-ssh-key') {
      options.stagingSshKey = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--artifact-dir') {
      options.artifactDir = resolve(nextArg(rest, index, arg));
      index += 1;
    } else if (arg === '--openpath-root') {
      options.openpathRoot = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--target-sha') {
      options.targetSha = nextArg(rest, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function defaultArtifactDir() {
  return resolve(
    '.opencode/tmp/prepromotion-windows-evidence',
    `staging-${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
}

function loadStagingVerification(options) {
  if (options.stagingVerification) {
    return readStagingVerificationFromFile(options.stagingVerification);
  }
  if (options.stagingHost) {
    return readStagingVerificationFromHost({
      stagingHost: options.stagingHost,
      stagingUser: options.stagingUser,
      stagingPort: options.stagingPort,
      stagingSshKey: options.stagingSshKey,
    });
  }
  if (options.command === 'inspect') {
    throw new Error('inspect requires --staging-verification or --staging-host');
  }
  return {};
}

function printInspect(requirement) {
  console.log(`required=${requirement.required ? 'true' : 'false'}`);
  console.log(`reason=${requirement.reason}`);
  console.log(`command=${requirement.command}`);
  if (requirement.required) {
    console.log(`persist_command=${requirement.persistCommand}`);
  }
}

function printPersisted(result) {
  for (const [key, value] of Object.entries(result.persisted)) {
    console.log(`${key}=${value}`);
  }
  console.log(`artifact_path=${result.artifactPath}`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  if (!['inspect', 'run-and-persist'].includes(options.command)) {
    console.error(`Unsupported command: ${options.command ?? '(none)'}`);
    printUsage();
    process.exit(1);
  }

  const artifactDir = options.artifactDir || defaultArtifactDir();
  let stagingVerification;
  const effectiveEnv = buildPrepromotionProcessEnv({
    cwd: process.cwd(),
    env: process.env,
  });
  if (!options.stagingSshKey) {
    options.stagingSshKey = effectiveEnv.STAGING_SSH_KEY ?? '';
  }

  try {
    stagingVerification = loadStagingVerification(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (options.command === 'inspect') {
    printInspect(
      resolveWindowsPrepromotionRequirement({
        stagingVerification,
        artifactDir,
        openpathRoot: options.openpathRoot,
        targetSha: options.targetSha,
      })
    );
    return;
  }

  try {
    const result = runAndPersistWindowsPrepromotionEvidence({
      artifactDir,
      openpathRoot: options.openpathRoot,
      targetSha: options.targetSha,
      stagingVerification,
      env: effectiveEnv,
      cwd: process.cwd(),
    });
    printPersisted(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
