#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import {
  parseDeployedReleaseState,
  serializeDeployedReleaseStateOutputs,
} from './lib/deployed-release-state.mjs';

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { stateFile: null, pointerReleaseId: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--state-file':
        args.stateFile = readValue(argv, ++index, '--state-file');
        break;
      case '--pointer-release-id':
        args.pointerReleaseId = readValue(argv, ++index, '--pointer-release-id');
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!args.help && !args.stateFile) {
    throw new Error('--state-file is required');
  }
  if (!args.help && !args.pointerReleaseId) {
    throw new Error('--pointer-release-id is required');
  }
  return args;
}

function usage() {
  return `Usage: node scripts/resolve-deployed-release-state.mjs --state-file <path> --pointer-release-id <releaseId>

Validates the exact current Release Bundle v2 runtime projection without sourcing it.
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
  } else {
    const state = parseDeployedReleaseState({
      runtimeText: readFileSync(args.stateFile, 'utf8'),
      pointerReleaseId: args.pointerReleaseId,
    });
    process.stdout.write(serializeDeployedReleaseStateOutputs(state));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
