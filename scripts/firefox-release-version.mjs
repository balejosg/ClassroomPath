#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function normalizeRunIdSuffix(runId, suffixLength = 7) {
  const normalizedRunId = String(runId ?? '').trim();
  if (!/^\d+$/.test(normalizedRunId)) {
    throw new Error(`run-id must be numeric, got ${JSON.stringify(runId)}`);
  }

  const suffix = normalizedRunId.slice(-suffixLength);
  return String(Number.parseInt(suffix, 10));
}

export function validateFirefoxReleaseVersion(version) {
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedVersion) {
    throw new Error('Firefox release version must not be empty');
  }

  const segments = normalizedVersion.split('.');
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Firefox release version ${normalizedVersion} contains an empty segment`);
  }

  for (const segment of segments) {
    if (/^\d+$/.test(segment) && segment.length > 1 && segment.startsWith('0')) {
      throw new Error(
        `Firefox release version ${normalizedVersion} contains a numeric segment with a leading zero (${segment})`
      );
    }
  }

  return normalizedVersion;
}

export function deriveFirefoxReleaseVersion({ baseVersion, runId, runAttempt }) {
  const normalizedBaseVersion = validateFirefoxReleaseVersion(baseVersion);
  const normalizedAttempt = String(runAttempt ?? '').trim();

  if (!/^\d+$/.test(normalizedAttempt)) {
    throw new Error(`run-attempt must be numeric, got ${JSON.stringify(runAttempt)}`);
  }

  const runIdComponent = normalizeRunIdSuffix(runId);
  const ciBuildSegment = `${runIdComponent}${normalizedAttempt.padStart(2, '0')}`;

  return validateFirefoxReleaseVersion(`${normalizedBaseVersion}.${ciBuildSegment}`);
}

export function deriveFirefoxReleaseVersionFromManifest({ manifestPath, runId, runAttempt }) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  return deriveFirefoxReleaseVersion({
    baseVersion: String(manifest.version ?? '').trim(),
    runId,
    runAttempt,
  });
}

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

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
