#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import {
  getReleaseStateSnapshotFields,
  readReleaseStateSnapshot,
  writeReleaseStateSnapshot,
} from './lib/release-state-contract.mjs';
import {
  buildPromotionEligibilityOutputs,
  evaluatePromotionEligibility,
} from './lib/promotion-eligibility.mjs';

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

      const report = evaluatePromotionEligibility({
        deploymentMode,
        imageSource: /** @type {'release-candidate' | 'source-build'} */ (
          currentState.IMAGE_SOURCE ?? 'source-build'
        ),
        currentState,
        verificationState,
        expectedRuntime: expected,
        highRisk,
      });

      writeReportJson(reportPath, report);

      if (!report.eligible) {
        emitErrors(report.errors);
        process.exitCode = 1;
        return;
      }

      appendOutputs(githubOutput, buildPromotionEligibilityOutputs(report));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

await main();
