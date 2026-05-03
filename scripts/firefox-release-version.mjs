#!/usr/bin/env node

import {
  deriveFirefoxReleaseVersionFromManifest,
  deriveFirefoxReleaseVersionFromSourceRevision,
  normalizeRunIdSuffix,
  validateFirefoxReleaseVersion,
  deriveFirefoxReleaseVersion,
} from './lib/firefox-release-version.mjs';
import { isDirectExecution } from './lib/github-actions.mjs';

function usage() {
  console.log(`Usage:
  node scripts/firefox-release-version.mjs --manifest <path> --source-revision <repo>
  node scripts/firefox-release-version.mjs --manifest <path> --run-id <id> --run-attempt <attempt>

Derives a Firefox/AMO-safe release version by appending a stable numeric segment
to the base extension version from manifest.json. Prefer --source-revision so
retries for the same OpenPath commit reuse the same AMO version.
`);
}

function parseArgs(argv) {
  const args = {
    manifest: '',
    sourceRevision: '',
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
      case '--source-revision':
        args.sourceRevision = value ?? '';
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
  deriveFirefoxReleaseVersionFromSourceRevision,
  normalizeRunIdSuffix,
  validateFirefoxReleaseVersion,
} from './lib/firefox-release-version.mjs';

function main() {
  const args = parseArgs(process.argv);
  if (!args.manifest) {
    throw new Error('--manifest is required');
  }

  const version = args.sourceRevision
    ? deriveFirefoxReleaseVersionFromSourceRevision({
        manifestPath: args.manifest,
        sourceRevision: args.sourceRevision,
      })
    : deriveFirefoxReleaseVersionFromManifest({
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
