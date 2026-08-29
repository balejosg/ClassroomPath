#!/usr/bin/env node

/**
 * CLI for reading and writing the release state snapshot, including staging evidence and promotion eligibility.
 *
 * Invoked by: GitHub Actions deploy and staging workflows; `release-state-cli.test.ts`.
 * Usage: node scripts/release-state-cli.mjs read|write|validate [options]
 * Env: RELEASE_STATE_PATH.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import {
  buildReleaseStatePromotionOutputs,
  getReleaseStateSnapshotFields,
  readReleaseStateSnapshot,
  validateReleaseStatePromotionEvidence,
  writeReleaseStateSnapshot,
} from './lib/release-state-contract.mjs';

// Exit-code contract for `verify-promotion-ready` (consumed by
// scripts/verify-production-promotion-ready.sh and the nightly workflow):
//   0  -> evidence is promotion-eligible
//   10 -> the gate evaluated successfully and the evidence is NOT eligible
//         (expected steady state between promotions)
//   1  -> the gate itself crashed (unreadable snapshot, bad options, ...)
// `verify-staging` keeps exit 1 for ineligible evidence: its callers treat
// any failure identically and are out of scope for this contract.
const PROMOTION_BLOCKED_EXIT_CODE = 10;

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
    EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE: env.EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE,
    EXPECTED_OPENPATH_API_IMAGE: env.EXPECTED_OPENPATH_API_IMAGE,
    EXPECTED_OPENPATH_VERSION: env.EXPECTED_OPENPATH_VERSION,
    EXPECTED_OPENPATH_LINUX_AGENT_VERSION: env.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
    EXPECTED_SPA_IMAGE: env.EXPECTED_SPA_IMAGE,
    EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:
      env.EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION,
    EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:
      env.EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT,
    EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:
      env.EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG,
    EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:
      env.EXPECTED_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256,
  };
}

function writeReportJson(reportPath, report) {
  if (!reportPath) {
    return;
  }

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
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
    case 'list-fields': {
      const snapshotType = requireOption(options, 'snapshot-type');
      process.stdout.write(`${getReleaseStateSnapshotFields(snapshotType).join('\n')}\n`);
      return;
    }
    case 'verify-staging':
    case 'verify-promotion-ready': {
      const currentPath = requireOption(options, 'current');
      const verificationPath = requireOption(options, 'verification');
      const githubOutput = options['github-output'] ?? process.env.GITHUB_OUTPUT ?? '';
      const reportPath = options['report-json'] ?? '';
      const highRisk = String(options['high-risk'] ?? 'false') === 'true';
      const deploymentMode = /** @type {'promotion-eligible' | 'debug'} */ (
        options['deployment-mode'] ?? 'promotion-eligible'
      );

      const currentState = readReleaseStateSnapshot(currentPath);
      const verificationState = readReleaseStateSnapshot(verificationPath);
      const expected = expectedRuntimeFromEnv(process.env);

      const report = validateReleaseStatePromotionEvidence({
        deploymentMode,
        currentState,
        verificationState,
        expectedRuntime: expected,
        highRisk,
      });

      writeReportJson(reportPath, report);

      if (!report.eligible) {
        emitErrors(report.errors);
        process.exitCode = command === 'verify-promotion-ready' ? PROMOTION_BLOCKED_EXIT_CODE : 1;
        return;
      }

      appendOutputs(githubOutput, buildReleaseStatePromotionOutputs(report));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

await main();
