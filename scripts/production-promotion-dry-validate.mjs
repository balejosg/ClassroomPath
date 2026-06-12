#!/usr/bin/env node

/**
 * Dry-runs the production promotion eligibility checks against the current staging evidence without mutating any state.
 *
 * Invoked by: Developer CLI via `npm run verify:production-promotion-dry`; tested by `deployment-foundation.test.ts`.
 * Usage: node scripts/production-promotion-dry-validate.mjs
 * Env: RELEASE_EVIDENCE_PATH.
 */

import { readFileSync } from 'node:fs';

import { collectProductionPromotionDryRunFailures } from './lib/release-evidence-contract.mjs';

function usage() {
  return `Usage: npm run verify:production-promotion-dry -- --release-evidence <path> [options]

Validates promotion evidence without deploying, tagging, or reading production.

Required:
  --release-evidence <path>      release-evidence.json to validate.

Options:
  --expected-classroom-sha <sha> Expected ClassroomPath SHA.
  --expected-openpath-sha <sha>  Expected OpenPath SHA.
  --tag <vX.Y.Z>                 Expected production tag.
  --windows-canary-dir <path>    Downloaded Windows canary artifact directory.
  --linux-canary-dir <path>      Downloaded Linux canary artifact directory.
  --help                         Show this help.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    releaseEvidencePath: null,
    expectedClassroomSha: null,
    expectedOpenPathSha: null,
    tag: null,
    windowsCanaryDir: null,
    linuxCanaryDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--release-evidence':
        args.releaseEvidencePath = readValue(argv, ++index, arg);
        break;
      case '--expected-classroom-sha':
        args.expectedClassroomSha = readValue(argv, ++index, arg);
        break;
      case '--expected-openpath-sha':
        args.expectedOpenPathSha = readValue(argv, ++index, arg);
        break;
      case '--tag':
        args.tag = readValue(argv, ++index, arg);
        break;
      case '--windows-canary-dir':
        args.windowsCanaryDir = readValue(argv, ++index, arg);
        break;
      case '--linux-canary-dir':
        args.linuxCanaryDir = readValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.releaseEvidencePath) {
    throw new Error('--release-evidence is required');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const releaseEvidence = JSON.parse(readFileSync(args.releaseEvidencePath, 'utf8'));
  const validation = collectProductionPromotionDryRunFailures({
    releaseEvidence,
    expectedClassroomSha: args.expectedClassroomSha,
    expectedOpenPathSha: args.expectedOpenPathSha,
    tag: args.tag,
    windowsCanaryDir: args.windowsCanaryDir,
    linuxCanaryDir: args.linuxCanaryDir,
  });

  if (!validation.ok) {
    throw new Error(
      `Production promotion dry validation failed: ${validation.failures.join('; ')}`
    );
  }

  process.stdout.write('Production promotion dry validation passed.\n');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
