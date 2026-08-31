/**
 * Waits for a release-candidate GitHub Actions run to complete and emits the artifact download URL when ready.
 *
 * Invoked by: GitHub Actions release-candidate and deploy workflows; `wait-for-release-candidate.test.ts`.
 * Usage: node scripts/wait-for-release-candidate.mjs --run-id <id> [--timeout <duration>]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution, normalizeWorkflowRunId, writeOutputs } from './lib/github-actions.mjs';
import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';
import {
  buildReleaseCandidateManifestOutputs,
  waitForFirefoxReleaseAssets,
  waitForReleaseCandidateManifest,
} from './lib/release-candidate.mjs';
import {
  buildReleaseCandidateBundleProjectionOutputs,
  waitForExactReleaseCandidateBundle,
} from './lib/release-candidate-bundle.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-manifest --sha <sha> [--repo <owner/repo>] [--timeout-seconds <seconds>] [--interval-seconds <seconds>] [--output-file <path>]'
  );
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-firefox-assets --openpath-sha <sha> [--repo <owner/repo>] [--timeout-seconds <seconds>] [--interval-seconds <seconds>] [--output-dir <path>]'
  );
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-bundle --sha <sha> [--run-id <id>] [--release-id <id>] [--repo <owner/repo>] [--timeout-seconds <seconds>] [--interval-seconds <seconds>] [--output-file <path>] [--output-dir <path>]'
  );
}

function parseCliArgs(argv) {
  const parsed = parseCommandLine(argv, {
    valueFlags: [
      '--interval-seconds',
      '--openpath-sha',
      '--output-dir',
      '--output-file',
      '--legacy-manifest-file',
      '--release-id',
      '--repo',
      '--run-id',
      '--sha',
      '--timeout-seconds',
    ],
  });

  return {
    command: parsed.command,
    options: {
      ...parsed.options,
      intervalSeconds: parsed.options['interval-seconds']
        ? Number(parsed.options['interval-seconds'])
        : undefined,
      openpathSha: parsed.options['openpath-sha'],
      bundleOutputDir: parsed.options['output-dir'],
      outputDir: parsed.options['output-dir'],
      outputFile: parsed.options['output-file'],
      legacyManifestFile: parsed.options['legacy-manifest-file'],
      releaseId: parsed.options['release-id'],
      repo: parsed.options.repo,
      runId: parsed.options['run-id'],
      sha: parsed.options.sha,
      timeoutSeconds: parsed.options['timeout-seconds']
        ? Number(parsed.options['timeout-seconds'])
        : undefined,
    },
  };
}

export function runReleaseCandidateCli(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);

  if (command === 'resolve-manifest' && options.sha) {
    const result = waitForReleaseCandidateManifest({
      sha: options.sha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputFile: options.outputFile,
      upstreamSha: process.env.UPSTREAM_OPENPATH_SHA,
      cwd: projectRoot,
    });

    writeOutputs(
      buildReleaseCandidateManifestOutputs({
        repository: result.repository,
        runId: result.runId,
        manifest: result.manifest,
      })
    );
    return;
  }

  if (command === 'resolve-firefox-assets') {
    const openpathSha = requireCliOption(
      options,
      'openpathSha',
      'Usage error: --openpath-sha is required for resolve-firefox-assets'
    );
    const result = waitForFirefoxReleaseAssets({
      openpathSha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputDir: options.outputDir,
      cwd: projectRoot,
    });

    writeOutputs({
      repository: result.repository,
      run_id: result.runId,
      openpath_sha: openpathSha,
      artifact_name: result.artifactName,
    });
    return;
  }

  if (command === 'resolve-bundle' && options.sha) {
    const result = waitForExactReleaseCandidateBundle({
      classroomPathSha: options.sha,
      runId: options.runId,
      releaseId: options.releaseId,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputFile: options.outputFile,
      outputDir: options.bundleOutputDir,
      legacyManifestFile: options.legacyManifestFile,
      cwd: projectRoot,
    });
    const output = {
      ...buildReleaseCandidateBundleProjectionOutputs(result),
      release_bundle_run_id: result.runId,
      release_bundle_artifact: result.artifactName,
      release_bundle_path: result.bundlePath ?? '',
      openpath_contract_path: result.contractPath ?? '',
    };
    writeOutputs(output);
    return;
  }

  printUsage();
  return 1;
}

export * from './lib/release-candidate.mjs';
export { normalizeWorkflowRunId as resolveWorkflowRunId } from './lib/github-actions.mjs';

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli(runReleaseCandidateCli);
}
