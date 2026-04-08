import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution, normalizeWorkflowRunId, writeOutputs } from './lib/github-actions.mjs';
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
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === '--sha') {
      options.sha = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--repo') {
      options.repo = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--timeout-seconds') {
      options.timeoutSeconds = Number(rest[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--interval-seconds') {
      options.intervalSeconds = Number(rest[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--output-file') {
      options.outputFile = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--openpath-sha') {
      options.openpathSha = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--output-dir') {
      options.outputDir = rest[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
}

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

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

  if (command === 'resolve-firefox-assets' && options.openpathSha) {
    const result = waitForFirefoxReleaseAssets({
      openpathSha: options.openpathSha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputDir: options.outputDir,
      cwd: projectRoot,
    });

    writeOutputs({
      repository: result.repository,
      run_id: result.runId,
      openpath_sha: options.openpathSha,
      artifact_name: result.artifactName,
    });
    return;
  }

  printUsage();
  process.exit(1);
}

export * from './lib/release-candidate.mjs';
export { normalizeWorkflowRunId as resolveWorkflowRunId } from './lib/github-actions.mjs';

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
