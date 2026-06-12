#!/usr/bin/env node

/**
 * CLI wrapper for the release risk detector: emits per-platform risk outputs for use in CI and deploy gating.
 *
 * Invoked by: GitHub Actions release-candidate and deploy workflows.
 * Usage: node scripts/release-risk-cli.mjs [--base <sha>] [--head <sha>]
 * Env: GITHUB_TOKEN.
 */

import process from 'node:process';

import {
  emitReleaseRiskOutputs,
  evaluateReleaseRisk,
  listReleaseRiskChangedFiles,
  resolveReleaseRiskBaseRef,
  resolveReleaseRiskTargetSha,
} from './lib/release-risk.mjs';

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

function readStdin() {
  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
  });
}

function printDiagnostics(result, changedFiles) {
  if (result.canary) {
    console.log(`Release risk canary: ${result.canary}`);
  }
  console.log(`Release risk base source: ${result.baseSource ?? 'unknown'}`);
  console.log(`Release risk base ref: ${result.baseRef || '(none)'}`);
  console.log(`Release risk target SHA: ${result.targetSha}`);

  if (result.matchedRules.length > 0) {
    console.log(
      `High-risk rules matched: ${result.matchedRules.map((rule) => rule.id).join(', ')}`
    );
  }

  if (changedFiles.length > 0) {
    console.log(`Changed files considered: ${changedFiles.length}`);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'classify-stdin': {
      const stdin = await readStdin();
      const changedFiles = stdin
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const result = evaluateReleaseRisk(changedFiles, { canary: options.canary });
      process.exitCode = result.highRisk ? 0 : 1;
      return;
    }
    case 'detect-github-output': {
      const cwd = options.cwd || process.cwd();
      const targetSha = resolveReleaseRiskTargetSha(process.env, cwd);
      const { baseRef, baseSource } = resolveReleaseRiskBaseRef(process.env, cwd);
      const changedFiles = listReleaseRiskChangedFiles(baseRef, targetSha, cwd);
      const risk = evaluateReleaseRisk(changedFiles, { canary: options.canary });
      const result = { ...risk, baseRef, baseSource, targetSha, canary: options.canary };

      printDiagnostics(result, changedFiles);
      emitReleaseRiskOutputs(options['github-output'] ?? process.env.GITHUB_OUTPUT ?? '', result);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

await main();
