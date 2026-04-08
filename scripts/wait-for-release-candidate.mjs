import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution, normalizeWorkflowRunId, writeOutputs } from './lib/github-actions.mjs';
import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';
import {
  buildReleaseCandidateManifestOutputs,
  waitForFirefoxReleaseAssets,
  waitForReleaseCandidateManifest,
} from './lib/release-candidate.mjs';

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
}

function parseCliArgs(argv) {
  const parsed = parseCommandLine(argv, {
    valueFlags: [
      '--interval-seconds',
      '--openpath-sha',
      '--output-dir',
      '--output-file',
      '--repo',
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
      outputDir: parsed.options['output-dir'],
      outputFile: parsed.options['output-file'],
      repo: parsed.options.repo,
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

  printUsage();
  return 1;
}

export * from './lib/release-candidate.mjs';
export { normalizeWorkflowRunId as resolveWorkflowRunId } from './lib/github-actions.mjs';

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli(runReleaseCandidateCli);
}
