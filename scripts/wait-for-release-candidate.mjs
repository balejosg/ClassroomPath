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
  writeReleaseCandidateBundleLegacyManifest,
  writeReleaseCandidateBundleRuntimeEnv,
  writeResolvedReleaseCandidateBundleArtifacts,
  waitForExactReleaseCandidateBundle,
} from './lib/release-candidate-bundle.mjs';
import { resolveExplicitReleaseCandidateBundle } from './lib/release-candidate-resolution.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

/** @typedef {Record<string, unknown> & {
 *   intervalSeconds?: number;
 *   openpathSha?: string;
 *   bundleOutputDir?: string;
 *   outputDir?: string;
 *   outputFile?: string;
 *   legacyManifestFile?: string;
 *   releaseId?: string;
 *   repo?: string;
 *   rcRunId?: string;
 *   runId?: string;
 *   sha?: string;
 *   timeoutSeconds?: number;
 * }} ReleaseCandidateCliOptions
 */
/**
 * @typedef {object} ReleaseCandidateBundleOptions
 * @property {string} [classroomPathSha]
 * @property {string} [runId]
 * @property {string} [releaseId]
 * @property {string} [repository]
 * @property {number} [timeoutSeconds]
 * @property {number} [intervalSeconds]
 * @property {string} [outputFile]
 * @property {string} [outputDir]
 * @property {string} [legacyManifestFile]
 * @property {string} [cwd]
 */
/**
 * @typedef {object} ReleaseCandidateBundleResult
 * @property {string|number} [runId]
 * @property {string} [artifactName]
 * @property {string} [bundlePath]
 * @property {string} [contractPath]
 * @property {Record<string, unknown>} [runtime]
 */

/**
 * @typedef {object} ReleaseCandidateManifestOptions
 * @property {string} [sha]
 * @property {string} [repository]
 * @property {number} [timeoutSeconds]
 * @property {number} [intervalSeconds]
 * @property {string} [outputFile]
 * @property {string} [upstreamSha]
 * @property {string} [cwd]
 */
/**
 * @typedef {object} FirefoxReleaseAssetsOptions
 * @property {string} [openpathSha]
 * @property {string} [repository]
 * @property {number} [timeoutSeconds]
 * @property {number} [intervalSeconds]
 * @property {string} [outputDir]
 * @property {string} [cwd]
 */

const RELEASE_CANDIDATE_VALUE_FLAGS = [
  '--interval-seconds',
  '--openpath-sha',
  '--output-dir',
  '--output-file',
  '--legacy-manifest-file',
  '--release-id',
  '--repo',
  '--rc-run-id',
  '--run-id',
  '--sha',
  '--timeout-seconds',
];

/**
 * Keep the imported bundle resolver at its exact CLI boundary. Its runtime
 * contract is broader than the historical inferred JavaScript parameter type.
 * @type {(options: ReleaseCandidateBundleOptions) => ReleaseCandidateBundleResult|undefined}
 */
const waitForExactReleaseCandidateBundleForCli = waitForExactReleaseCandidateBundle;

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
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-bundle --rc-run-id <id> [--release-id <id>] [--repo <owner/repo>] [--output-file <path>] [--output-dir <path>]'
  );
}

/**
 * @param {string[]} argv
 * @returns {{command?: string; options: ReleaseCandidateCliOptions}}
 */
export function parseReleaseCandidateCliArgs(argv) {
  const parsed = parseCommandLine(argv, { valueFlags: RELEASE_CANDIDATE_VALUE_FLAGS });

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
      rcRunId: parsed.options['rc-run-id'],
      runId: parsed.options['run-id'],
      sha: parsed.options.sha,
      timeoutSeconds: parsed.options['timeout-seconds']
        ? Number(parsed.options['timeout-seconds'])
        : undefined,
    },
  };
}

export function runReleaseCandidateCli(argv = process.argv.slice(2)) {
  const { command, options } = parseReleaseCandidateCliArgs(argv);

  if (command === 'resolve-manifest' && options.sha) {
    /** @type {ReleaseCandidateManifestOptions} */
    const manifestOptions = {
      sha: options.sha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputFile: options.outputFile,
      upstreamSha: process.env.UPSTREAM_OPENPATH_SHA,
      cwd: projectRoot,
    };
    const result = waitForReleaseCandidateManifest({
      ...manifestOptions,
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
    /** @type {FirefoxReleaseAssetsOptions} */
    const firefoxAssetsOptions = {
      openpathSha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputDir: options.outputDir,
      cwd: projectRoot,
    };
    const result = waitForFirefoxReleaseAssets({ ...firefoxAssetsOptions });

    writeOutputs({
      repository: result.repository,
      run_id: result.runId,
      openpath_sha: openpathSha,
      artifact_name: result.artifactName,
    });
    return;
  }

  if (command === 'resolve-bundle' && options.sha) {
    const result = waitForExactReleaseCandidateBundleForCli({
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
    if (!result) {
      throw new Error('Release Bundle resolver returned no result');
    }
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

  if (command === 'resolve-bundle' && options.rcRunId) {
    const result = resolveExplicitReleaseCandidateBundle({
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      rcRunId: options.rcRunId,
      releaseId: options.releaseId,
      cwd: projectRoot,
    });
    if (options.outputFile) {
      writeReleaseCandidateBundleRuntimeEnv(options.outputFile, result.runtime);
    }
    if (options.legacyManifestFile) {
      writeReleaseCandidateBundleLegacyManifest(options.legacyManifestFile, result);
    }
    if (options.outputDir) {
      Object.assign(
        result,
        writeResolvedReleaseCandidateBundleArtifacts(options.outputDir, result)
      );
    }
    writeOutputs({
      ...buildReleaseCandidateBundleProjectionOutputs(result),
      release_bundle_run_id: result.runId,
      release_bundle_artifact: result.artifactName,
      release_bundle_path: result.bundlePath ?? '',
      openpath_contract_path: result.contractPath ?? '',
    });
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
