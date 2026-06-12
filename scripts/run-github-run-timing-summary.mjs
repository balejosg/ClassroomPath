#!/usr/bin/env node

/**
 * Fetches GitHub Actions run timing data and writes a Markdown summary report for the given workflow run.
 *
 * Invoked by: Developer CLI via `npm run diagnostics:run-timing`; `runner-diagnostic.test.ts`.
 * Usage: node scripts/run-github-run-timing-summary.mjs [--run-id <id>]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatRunTimingMarkdown, summarizeRunTiming } from './lib/github-actions-run-timing.mjs';

const GH_RUN_VIEW_JSON_FIELDS = 'databaseId,status,conclusion,createdAt,updatedAt,jobs';

function parseArgs(argv) {
  const options = {
    repo: null,
    runId: null,
    artifactDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--repo') {
      options.repo = next;
      index += 1;
    } else if (arg === '--run-id') {
      options.runId = next;
      index += 1;
    } else if (arg === '--artifact-dir') {
      options.artifactDir = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.repo) {
    throw new Error('Missing required argument: --repo');
  }
  if (!options.runId) {
    throw new Error('Missing required argument: --run-id');
  }

  return options;
}

function buildGhRunViewArgs({ repo, runId }) {
  return ['run', 'view', String(runId), '--repo', repo, '--json', GH_RUN_VIEW_JSON_FIELDS];
}

function printCommand(command, args) {
  console.log([command, ...args].join(' '));
}

function loadRunPayload({ repo, runId, dryRun }) {
  const args = buildGhRunViewArgs({ repo, runId });
  if (dryRun) {
    printCommand('gh', args);
    return {
      databaseId: Number(runId),
      status: 'completed',
      conclusion: 'success',
      createdAt: null,
      updatedAt: null,
      jobs: [],
    };
  }

  const output = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(output);
}

function writeSummaryArtifact(artifactDir, summary) {
  const outputDir = resolve(artifactDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, 'run-timing-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
}

export function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const payload = loadRunPayload({
    repo: options.repo,
    runId: options.runId,
    dryRun: env.RUN_TIMING_DRY_RUN === '1',
  });
  const summary = summarizeRunTiming({ run: payload, jobs: payload.jobs ?? [] });

  if (options.artifactDir) {
    writeSummaryArtifact(options.artifactDir, summary);
  }

  console.log(formatRunTimingMarkdown(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
