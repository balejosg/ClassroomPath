#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  dispatchWorkflow,
  downloadArtifacts,
  waitForRun,
} from './lib/github-actions-diagnostic-client.mjs';

const DRY_RUN = process.env.STAGING_LINUX_BOOTSTRAP_GATE_DRY_RUN === '1';
const repo = process.env.STAGING_LINUX_BOOTSTRAP_GATE_REPO ?? 'balejosg/ClassroomPath';
const workflow = 'linux-production-bootstrap-canary.yml';
const ref = process.env.STAGING_LINUX_BOOTSTRAP_GATE_REF ?? 'main';
const gateId =
  process.env.STAGING_LINUX_BOOTSTRAP_GATE_ID ??
  `staging-linux-bootstrap-${Date.now()}-${process.pid}`;
const baseUrl =
  process.env.STAGING_LINUX_BOOTSTRAP_GATE_BASE_URL ??
  process.env.CANONICAL_STAGING_URL ??
  'https://classroompath-staging.duckdns.org';
const outputPath =
  process.env.STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT ?? '/tmp/linux-bootstrap-gate.env';
const runResolveTimeoutMs = Number(
  process.env.STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_TIMEOUT_MS ?? 180_000
);
const runResolvePollMs = Number(
  process.env.STAGING_LINUX_BOOTSTRAP_GATE_RUN_RESOLVE_POLL_MS ?? 5_000
);

function writeOutput(fields) {
  const shellQuote = (value) =>
    `'${String(value ?? '')
      .replaceAll('\n', ' ')
      .replaceAll("'", "'\\''")}'`;
  const text = `${Object.entries(fields)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join('\n')}\n`;
  if (DRY_RUN) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(outputPath, text, 'utf8');
}

function extractCanarySummary(evidenceDir) {
  const candidates = [
    resolve(evidenceDir, 'linux-production-bootstrap-canary-evidence.tgz'),
    resolve(
      evidenceDir,
      'linux-production-bootstrap-canary',
      'linux-production-bootstrap-canary-evidence.tgz'
    ),
  ];
  const bundle = candidates.find((candidate) => existsSync(candidate));
  if (!bundle) {
    throw new Error(`Linux bootstrap canary artifact bundle not found in ${evidenceDir}`);
  }

  const result = spawnSync(
    'tar',
    ['-xOzf', bundle, 'production-linux-ajax-auto-allow-canary.json'],
    {
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || 'Unable to read Linux bootstrap canary JSON from artifact bundle'
    );
  }

  return JSON.parse(result.stdout);
}

function renderCommand(args) {
  return args
    .map((arg) => (/^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(' ');
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listGateRuns() {
  const args = [
    'gh',
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    workflow,
    '--branch',
    ref,
    '--limit',
    '20',
    '--json',
    'databaseId,displayTitle,createdAt',
  ];

  if (DRY_RUN) {
    process.stdout.write(`${renderCommand(args)}\n`);
    return [
      { databaseId: '<latest-run-id>', displayTitle: gateId, createdAt: new Date().toISOString() },
    ];
  }

  const result = spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to list workflow runs for ${workflow}`);
  }

  return JSON.parse(result.stdout);
}

function findGateRunId({ dispatchedAt = Date.now() } = {}) {
  const deadline = Date.now() + runResolveTimeoutMs;
  let recentRuns = [];

  do {
    const runs = listGateRuns();
    recentRuns = runs;
    const match = runs.find((run) => {
      const displayTitle = String(run.displayTitle ?? '');
      const createdAt = Date.parse(String(run.createdAt ?? ''));
      return (
        displayTitle.includes(gateId) &&
        (Number.isNaN(createdAt) || createdAt >= dispatchedAt - 60_000)
      );
    });
    if (match?.databaseId) {
      return String(match.databaseId);
    }
    if (Date.now() < deadline) {
      sleep(runResolvePollMs);
    }
  } while (Date.now() < deadline);

  const recentTitles = recentRuns
    .slice(0, 5)
    .map(
      (run) =>
        `${run.databaseId ?? 'unknown'} ${run.createdAt ?? 'unknown'} ${run.displayTitle ?? ''}`
    )
    .join('\n');
  throw new Error(
    `Could not resolve Linux bootstrap gate run for gate_id=${gateId} after ${runResolveTimeoutMs}ms. Recent ${workflow} runs:\n${recentTitles}`
  );
}

function writeEarlyFailure(runId, boundaryId, message) {
  writeOutput({
    STAGING_LINUX_BOOTSTRAP_RESULT: 'failure',
    STAGING_LINUX_BOOTSTRAP_RUN_ID: runId,
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: boundaryId,
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE: message,
  });
}

function resolveGateRunId(dispatchedAt) {
  try {
    return findGateRunId({ dispatchedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeEarlyFailure('', 'workflow-run-resolution', message);
    throw error;
  }
}

function main() {
  const dispatchedAt = Date.now();
  dispatchWorkflow({
    repo,
    workflow,
    ref,
    fields: {
      target_environment: 'staging',
      base_url: baseUrl,
      diagnostic_mode: 'false',
      gate_id: gateId,
    },
    dryRun: DRY_RUN,
  });

  const runId = resolveGateRunId(dispatchedAt);

  const watchResult = waitForRun({ repo, runId, dryRun: DRY_RUN });
  const watchStatus = typeof watchResult === 'object' ? watchResult.status : 0;
  const evidenceDir = resolve('.opencode/tmp/staging-linux-bootstrap-gate', String(runId));

  if (DRY_RUN) {
    writeOutput({
      STAGING_LINUX_BOOTSTRAP_RESULT: 'success',
      STAGING_LINUX_BOOTSTRAP_RUN_ID: runId,
      STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'none',
      STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:
        'Linux AJAX auto-allow canary completed successfully.',
    });
    return;
  }

  mkdirSync(evidenceDir, { recursive: true });
  const downloadStatus = downloadArtifacts({ repo, runId, evidenceDir }).status;
  let summary = {};
  try {
    summary = extractCanarySummary(evidenceDir);
  } catch (error) {
    summary = {
      success: false,
      failureBoundary: {
        id: 'artifact-written',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const success = watchStatus === 0 && downloadStatus === 0 && summary.success === true;
  writeOutput({
    STAGING_LINUX_BOOTSTRAP_RESULT: success ? 'success' : 'failure',
    STAGING_LINUX_BOOTSTRAP_RUN_ID: runId,
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: summary.failureBoundary?.id ?? 'unknown',
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE: summary.failureBoundary?.message ?? '',
  });

  if (!success) {
    process.exit(1);
  }
}

main();
