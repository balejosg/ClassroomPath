/**
 * Runtime utilities for the AJAX auto-allow canary: probe execution, timeout handling, and evidence aggregation.
 *
 * Invoked by: Imported by `ajax-auto-allow-canary-harness.mjs`.
 * Usage: (library module, not invoked directly)
 */
import { appendFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import {
  buildAjaxAutoAllowCanaryPage,
  createAjaxAutoAllowCanaryServer,
  createAjaxAutoAllowCanaryState,
} from './ajax-auto-allow-canary-harness.mjs';
import { createCanaryProgressReporter } from './canary-progress.mjs';

export function createAjaxAutoAllowCanaryRuntimeProgress({ canary, output } = {}) {
  return createCanaryProgressReporter({ canary, output });
}

export function writeAjaxAutoAllowCanaryGithubOutput(
  key,
  value,
  { env = process.env, append = appendFileSync } = {}
) {
  if (!env.GITHUB_OUTPUT) return false;
  append(env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
  return true;
}

export function createAjaxAutoAllowCanaryRuntimeServer({
  platformAdapter,
  port,
  timeoutMs,
  probeTimeoutMs,
  xhrTimeoutMs = probeTimeoutMs,
  redditDiagnosticTimeoutMs,
  maxAttemptEvidence,
  onResult,
}) {
  const state = createAjaxAutoAllowCanaryState(platformAdapter.probes, {
    redditDiagnosticProbes: platformAdapter.redditDiagnosticProbes ?? [],
  });
  const server = createAjaxAutoAllowCanaryServer({
    platform: platformAdapter.label,
    probes: platformAdapter.probes,
    originHost: platformAdapter.originHost,
    port,
    state,
    maxAttempts: maxAttemptEvidence,
    redact: platformAdapter.redact,
    scriptGlobalName: platformAdapter.scriptGlobalName,
    stylesheetCss: platformAdapter.stylesheetCss,
    onResult,
    buildPage: () =>
      buildAjaxAutoAllowCanaryPage({
        platform: platformAdapter.label,
        probes: platformAdapter.probes,
        redditDiagnosticProbes: platformAdapter.redditDiagnosticProbes ?? [],
        originHost: platformAdapter.originHost,
        port,
        timeoutMs,
        probeTimeoutMs,
        xhrTimeoutMs,
        redditDiagnosticTimeoutMs,
        stateGlobalName: platformAdapter.stateGlobalName,
        statusElement: platformAdapter.statusElement,
      }),
  });

  return { state, server };
}

export function listenAjaxAutoAllowCanaryRuntimeServer(server, { port, host = '0.0.0.0' } = {}) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

export async function emitAjaxAutoAllowCanaryRuntimeSummary({
  summary,
  artifactPath,
  summaryPrefix,
  resultOutputKey,
  failureBoundaryOutputs = false,
  emitArtifactProgress = true,
  progress = () => {},
  output = console,
  githubOutput = (key, value) => writeAjaxAutoAllowCanaryGithubOutput(key, value),
  writeArtifact = async (path, contents) => writeFile(path, contents, 'utf8'),
  summaryOutputStream = (candidateSummary) => (candidateSummary.success ? 'log' : 'error'),
}) {
  await writeArtifact(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (emitArtifactProgress) {
    progress('artifact-written', summary.success ? 'passed' : 'failed', {
      boundaryId: summary.failureBoundary?.id ?? 'unknown',
      message: summary.failureBoundary?.message ?? '',
    });
  }

  const summaryLine = `${summaryPrefix} ${JSON.stringify(summary)}`;
  const stream = summaryOutputStream(summary);
  if (stream === 'log') {
    output.log?.(summaryLine);
  } else {
    output.error?.(summaryLine);
  }

  githubOutput(resultOutputKey, summary.success ? 'success' : 'failure');
  if (failureBoundaryOutputs) {
    githubOutput('failure_boundary_id', summary.failureBoundary?.id ?? 'unknown');
    githubOutput('failure_boundary_message', summary.failureBoundary?.message ?? '');
  }
}
