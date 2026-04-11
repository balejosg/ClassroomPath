#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import process from 'node:process';

import {
  buildStagingReleaseEvidenceOutputs,
  readReleaseStateSnapshot,
  validateCurrentReleaseState,
  validateHighRiskStagingVerification,
  validateStagingVerification,
  writeReleaseStateSnapshot,
} from './lib/release-state-contract.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];

    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = 'true';
  }

  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];

  if (!value) {
    throw new Error(`Missing required option --${name}`);
  }

  return value;
}

function emitErrors(errors) {
  for (const error of errors) {
    console.error(error);
  }
}

function appendOutputs(outputPath, outputs) {
  if (!outputPath) {
    return;
  }

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf-8');
}

function expectedRuntimeFromEnv(env) {
  return {
    EXPECTED_APP_SHA: env.EXPECTED_APP_SHA,
    EXPECTED_GATEWAY_IMAGE: env.EXPECTED_GATEWAY_IMAGE,
    EXPECTED_MIGRATIONS_IMAGE: env.EXPECTED_MIGRATIONS_IMAGE,
    EXPECTED_OPENPATH_API_IMAGE: env.EXPECTED_OPENPATH_API_IMAGE,
    EXPECTED_OPENPATH_VERSION: env.EXPECTED_OPENPATH_VERSION,
    EXPECTED_OPENPATH_LINUX_AGENT_VERSION: env.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
    EXPECTED_SPA_IMAGE: env.EXPECTED_SPA_IMAGE,
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'write-snapshot': {
      const snapshotType = requireOption(options, 'snapshot-type');
      const outputPath = requireOption(options, 'output');
      writeReleaseStateSnapshot(snapshotType, outputPath, process.env);
      return;
    }
    case 'verify-staging': {
      const currentPath = requireOption(options, 'current');
      const verificationPath = requireOption(options, 'verification');
      const githubOutput = options['github-output'] ?? process.env.GITHUB_OUTPUT ?? '';
      const highRisk = String(options['high-risk'] ?? 'false') === 'true';

      const currentState = readReleaseStateSnapshot(currentPath);
      const verificationState = readReleaseStateSnapshot(verificationPath);
      const expected = expectedRuntimeFromEnv(process.env);

      const errors = [
        ...validateCurrentReleaseState(currentState, expected),
        ...validateStagingVerification(verificationState, expected),
      ];

      if (highRisk) {
        errors.push(...validateHighRiskStagingVerification(verificationState));
      }

      if (errors.length > 0) {
        emitErrors(errors);
        process.exitCode = 1;
        return;
      }

      appendOutputs(githubOutput, buildStagingReleaseEvidenceOutputs(verificationState));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

await main();
