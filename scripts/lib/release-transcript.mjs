/**
 * Builds and appends to the release transcript log, recording each promotion step with timestamp and outcome.
 *
 * Invoked by: Imported by release orchestration scripts.
 * Usage: (library module, not invoked directly)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TRANSCRIPT_ROOT = '.opencode/tmp/release-promote';

/**
 * @typedef {object} ReleaseTranscriptStep
 * @property {string} id
 * @property {string|null} [command]
 * @property {string} [status]
 * @property {number} [seconds]
 * @property {{runId?: string|number; url?: string}} [githubRun]
 * @property {string|number|null} [runId]
 * @property {string|null} [url]
 * @property {string|null} [retryOf]
 */
/** @typedef {{step?: string; reason?: string}} ReleaseTranscriptRetry */
/** @typedef {{step?: string; runId?: string|number}} ReleaseTranscriptRerun */
/**
 * @typedef {object} ReleaseTranscript
 * @property {string} [tag]
 * @property {string} [rcRunId]
 * @property {string} [status]
 * @property {string|null} [startedAt]
 * @property {string|null} [finishedAt]
 * @property {Record<string, string>} [shas]
 * @property {ReleaseTranscriptStep[]} [steps]
 * @property {ReleaseTranscriptRetry[]} [retries]
 * @property {ReleaseTranscriptRerun[]} [reruns]
 * @property {string|null} [healthStepResult]
 */

/**
 * @param {{tag?: string; rcRunId?: string; status?: string; startedAt?: string|null; finishedAt?: string|null; steps?: ReleaseTranscriptStep[]; retries?: ReleaseTranscriptRetry[]; reruns?: ReleaseTranscriptRerun[]; shas?: Record<string, string>}} [params]
 * @returns {ReleaseTranscript}
 */
export function buildReleaseTranscript({
  tag,
  rcRunId = '',
  status,
  startedAt = null,
  finishedAt = null,
  steps = [],
  retries = [],
  reruns = [],
  shas = {},
} = {}) {
  return {
    tag,
    ...(rcRunId ? { rcRunId } : {}),
    status,
    startedAt,
    finishedAt,
    shas,
    retries,
    reruns,
    healthStepResult: steps.find((step) => step.id === 'verify-production-health')?.status ?? null,
    steps: steps.map((step) => ({
      id: step.id,
      command: step.command ?? null,
      status: step.status,
      seconds: step.seconds,
      runId: step.githubRun?.runId ?? step.runId ?? null,
      url: step.githubRun?.url ?? step.url ?? null,
      retryOf: step.retryOf ?? null,
    })),
  };
}

/**
 * @param {{transcript?: ReleaseTranscript; root?: string; identityKey?: string}} [params]
 * @returns {{outputDir: string}}
 */
export function writeReleaseTranscript({
  transcript,
  root = DEFAULT_TRANSCRIPT_ROOT,
  identityKey,
} = {}) {
  if (!transcript?.tag) {
    throw new Error('release transcript requires tag');
  }

  const outputDir = join(root, identityKey || transcript.tag);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, 'release-promote-transcript.json'),
    `${JSON.stringify(transcript, null, 2)}\n`
  );
  writeFileSync(
    join(outputDir, 'release-promote-transcript.md'),
    renderReleaseTranscriptMarkdown(transcript)
  );
  return { outputDir };
}

/** @param {ReleaseTranscript} transcript */
export function renderReleaseTranscriptMarkdown(transcript) {
  const lines = [
    `# Release Promote Transcript: ${transcript.tag}`,
    '',
    `status: ${transcript.status}`,
    ...(transcript.rcRunId ? [`release_candidate_run_id: ${transcript.rcRunId}`] : []),
    `health_step_result: ${transcript.healthStepResult ?? 'n/a'}`,
    '',
    '| step | status | seconds | run |',
    '| --- | --- | ---: | --- |',
  ];

  for (const step of transcript.steps ?? []) {
    const run = step.runId ? `${step.runId}${step.url ? ` ${step.url}` : ''}` : 'n/a';
    lines.push(`| ${step.id} | ${step.status} | ${step.seconds ?? 0} | ${run} |`);
  }

  const retries = transcript.retries ?? [];
  if (retries.length > 0) {
    lines.push('', '## Retries');
    for (const retry of retries) {
      lines.push(`- ${retry.step}: ${retry.reason}`);
    }
  }

  const reruns = transcript.reruns ?? [];
  if (reruns.length > 0) {
    lines.push('', '## Reruns');
    for (const rerun of reruns) {
      lines.push(`- ${rerun.step}: run ${rerun.runId}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}`;
}
