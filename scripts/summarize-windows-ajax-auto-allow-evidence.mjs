#!/usr/bin/env node

/**
 * Reads Windows AJAX auto-allow canary evidence JSON and writes a Markdown summary for the GitHub Actions step summary.
 *
 * Invoked by: GitHub Actions `production-client-update-canary.yml` workflow; `runner-diagnostic-execution.test.ts`.
 * Usage: node scripts/summarize-windows-ajax-auto-allow-evidence.mjs [--input <file>] [--output <file>]
 */

import { appendFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import {
  buildWindowsAutoAllowArtifactFailureSummary,
  withWindowsAutoAllowDiagnostics,
} from './lib/windows-auto-allow-canary-evidence.mjs';

const DEFAULT_ARTIFACT_PATH = 'production-windows-ajax-auto-allow-canary.json';

function parseArgs(argv) {
  const options = {
    artifactPath: DEFAULT_ARTIFACT_PATH,
    summaryPath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--artifact') {
      options.artifactPath = next();
    } else if (arg === '--summary') {
      options.summaryPath = next();
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/summarize-windows-ajax-auto-allow-evidence.mjs [options]

Options:
  --artifact <path>  Evidence JSON to read and enrich (default: ${DEFAULT_ARTIFACT_PATH})
  --summary <path>   Optional markdown summary output path
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function writeGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

function renderPhaseEvidence(phase) {
  if (!phase?.evidence || typeof phase.evidence !== 'object') {
    return '';
  }

  if ('originHits' in phase.evidence) {
    return `originHits=${phase.evidence.originHits}`;
  }
  if ('candidateEventsCount' in phase.evidence) {
    return `candidateEvents=${phase.evidence.candidateEventsCount}`;
  }
  if ('artifactWritten' in phase.evidence) {
    return `artifactWritten=${phase.evidence.artifactWritten}`;
  }
  if (Array.isArray(phase.evidence.probeEvidence)) {
    return phase.evidence.probeEvidence.map((probe) => `${probe.id}:${probe.hits ?? 0}`).join(', ');
  }

  return '';
}

function renderMarkdown(summary) {
  const boundary = summary.failureBoundary;
  const lines = [
    '## Windows AJAX Auto-Allow Evidence',
    '',
    `- Functional result: \`${summary.success === true ? 'success' : 'failure'}\``,
    `- Failure boundary: \`${boundary?.id ?? 'unknown'}\``,
    `- Boundary message: ${boundary?.message ?? 'n/a'}`,
    `- Recommended next action: ${boundary?.recommendedNextAction ?? 'n/a'}`,
    '',
    '| Phase | Status | Evidence |',
    '| --- | --- | --- |',
  ];

  for (const phase of summary.diagnosticPhases ?? []) {
    lines.push(`| ${phase.id} | ${phase.status} | ${renderPhaseEvidence(phase)} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function readAndEnrichArtifact(artifactPath) {
  try {
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    return withWindowsAutoAllowDiagnostics(artifact);
  } catch (error) {
    return buildWindowsAutoAllowArtifactFailureSummary({
      id: 'artifact-written',
      artifactPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await readAndEnrichArtifact(options.artifactPath);
  const markdown = renderMarkdown(summary);

  if (summary.failureBoundary?.id !== 'artifact-written') {
    await writeFile(options.artifactPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  if (options.summaryPath) {
    await writeFile(options.summaryPath, `${markdown}\n`, 'utf8');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  writeGithubOutput('canary_result', summary.success === true ? 'success' : 'failure');
  writeGithubOutput('failure_boundary_id', summary.failureBoundary?.id ?? 'unknown');
  writeGithubOutput('failure_boundary_message', summary.failureBoundary?.message ?? '');

  console.log(markdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
