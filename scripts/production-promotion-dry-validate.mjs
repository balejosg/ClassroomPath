#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import {
  parseLinuxBootstrapCanaryArtifact,
  parseWindowsBootstrapCanaryArtifact,
  validateReleaseEvidenceChecklist,
  verifyArtifactIntegrity,
} from './lib/release-evidence-bundle.mjs';

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

function assertEqual({ actual, expected, label, failures }) {
  if (expected && actual !== expected) {
    failures.push(`${label} expected ${expected} but found ${actual ?? 'missing'}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const releaseEvidence = JSON.parse(readFileSync(args.releaseEvidencePath, 'utf8'));
  const failures = [...validateReleaseEvidenceChecklist(releaseEvidence).failures];

  assertEqual({
    actual: releaseEvidence?.release?.classroomPathSha,
    expected: args.expectedClassroomSha,
    label: 'release.classroomPathSha',
    failures,
  });
  assertEqual({
    actual: releaseEvidence?.release?.openPathSha,
    expected: args.expectedOpenPathSha,
    label: 'release.openPathSha',
    failures,
  });
  assertEqual({
    actual: releaseEvidence?.release?.tagName,
    expected: args.tag,
    label: 'release.tagName',
    failures,
  });

  const integrity = verifyArtifactIntegrity({
    releaseEvidence,
    windowsProductionBootstrapCanary: {
      listed: Boolean(args.windowsCanaryDir),
      artifactDir: args.windowsCanaryDir,
    },
    linuxProductionBootstrapCanary: {
      listed: Boolean(args.linuxCanaryDir),
      artifactDir: args.linuxCanaryDir,
    },
  });

  for (const [name, result] of Object.entries(integrity)) {
    if (result.status !== 'ok' && result.status !== 'not_applicable') {
      failures.push(`${name} ${result.status}${result.message ? `: ${result.message}` : ''}`);
    }
  }

  if (args.windowsCanaryDir) {
    parseWindowsBootstrapCanaryArtifact(args.windowsCanaryDir);
  }
  if (args.linuxCanaryDir) {
    parseLinuxBootstrapCanaryArtifact(args.linuxCanaryDir);
  }

  if (failures.length > 0) {
    throw new Error(`Production promotion dry validation failed: ${failures.join('; ')}`);
  }

  process.stdout.write('Production promotion dry validation passed.\n');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
