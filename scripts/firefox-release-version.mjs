#!/usr/bin/env node

import {
  deriveFirefoxReleaseVersionFromManifest,
  normalizeRunIdSuffix,
  validateFirefoxReleaseVersion,
  deriveFirefoxReleaseVersion,
} from './lib/firefox-release-version.mjs';
import { isDirectExecution } from './lib/github-actions.mjs';

function usage() {
  console.log(`Usage: node scripts/firefox-release-version.mjs --manifest <path> --run-id <id> --run-attempt <attempt>

Derives a Firefox/AMO-safe release version by appending a CI-specific numeric segment
to the base extension version from manifest.json.
`);
}

function parseArgs(argv) {
  const args = {
    manifest: '',
    runId: '',
    runAttempt: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    switch (token) {
      case '--manifest':
        args.manifest = value ?? '';
        index += 1;
        break;
      case '--run-id':
        args.runId = value ?? '';
        index += 1;
        break;
      case '--run-attempt':
        args.runAttempt = value ?? '';
        index += 1;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export {
  deriveFirefoxReleaseVersion,
  deriveFirefoxReleaseVersionFromManifest,
  normalizeRunIdSuffix,
  validateFirefoxReleaseVersion,
} from './lib/firefox-release-version.mjs';

function main() {
  const args = parseArgs(process.argv);
  if (!args.manifest || !args.runId || !args.runAttempt) {
    throw new Error('--manifest, --run-id, and --run-attempt are required');
  }

  const version = deriveFirefoxReleaseVersionFromManifest({
    manifestPath: args.manifest,
    runId: args.runId,
    runAttempt: args.runAttempt,
  });

  process.stdout.write(version);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
