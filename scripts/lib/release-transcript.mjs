import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TRANSCRIPT_ROOT = '.opencode/tmp/release-promote';

export function buildReleaseTranscript({
  tag,
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

export function writeReleaseTranscript({ transcript, root = DEFAULT_TRANSCRIPT_ROOT } = {}) {
  if (!transcript?.tag) {
    throw new Error('release transcript requires tag');
  }

  const outputDir = join(root, transcript.tag);
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

export function renderReleaseTranscriptMarkdown(transcript) {
  const lines = [
    `# Release Promote Transcript: ${transcript.tag}`,
    '',
    `status: ${transcript.status}`,
    `health_step_result: ${transcript.healthStepResult ?? 'n/a'}`,
    '',
    '| step | status | seconds | run |',
    '| --- | --- | ---: | --- |',
  ];

  for (const step of transcript.steps ?? []) {
    const run = step.runId ? `${step.runId}${step.url ? ` ${step.url}` : ''}` : 'n/a';
    lines.push(`| ${step.id} | ${step.status} | ${step.seconds ?? 0} | ${run} |`);
  }

  if ((transcript.retries ?? []).length > 0) {
    lines.push('', '## Retries');
    for (const retry of transcript.retries) {
      lines.push(`- ${retry.step}: ${retry.reason}`);
    }
  }

  if ((transcript.reruns ?? []).length > 0) {
    lines.push('', '## Reruns');
    for (const rerun of transcript.reruns) {
      lines.push(`- ${rerun.step}: run ${rerun.runId}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}`;
}
