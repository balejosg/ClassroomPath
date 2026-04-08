import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isDirectExecution,
  normalizeWorkflowRunHeadSha,
  readJsonFile,
  writeOutputs,
} from './lib/github-actions.mjs';
import {
  buildReleaseImageOutputs,
  buildReleaseManifestOutputs,
  deriveTaggedImageRefs,
  parseReleaseCandidateManifest,
  selectLatestSuccessfulWorkflowRun,
  selectSuccessfulReleaseCandidateRun,
} from './lib/release-images.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/release-images.mjs outputs --sha <sha> [--owner <owner>]');
  console.error(
    '  node scripts/release-images.mjs select-run-id --sha <sha> --runs-file <workflow-runs.json>'
  );
  console.error(
    '  node scripts/release-images.mjs select-latest-successful-run --runs-file <workflow-runs.json>'
  );
  console.error(
    '  node scripts/release-images.mjs manifest-outputs --sha <sha> --file <release-candidate-images.env>'
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

    if (token === '--owner') {
      options.owner = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--file') {
      options.file = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--runs-file') {
      options.runsFile = rest[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
}

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

  if (command === 'outputs') {
    if (!options.sha) {
      printUsage();
      process.exit(1);
    }

    const refs = deriveTaggedImageRefs({
      sha: options.sha,
      repositoryOwner: options.owner ?? process.env.GITHUB_REPOSITORY_OWNER,
      repository: process.env.GITHUB_REPOSITORY,
      cwd: projectRoot,
    });

    writeOutputs(buildReleaseImageOutputs(refs));
    return;
  }

  if (command === 'select-run-id' && options.runsFile) {
    if (!options.sha) {
      printUsage();
      process.exit(1);
    }

    const payload = readJsonFile(options.runsFile);
    const run = selectSuccessfulReleaseCandidateRun(payload, { sha: options.sha });
    writeOutputs({ run_id: run.id });
    return;
  }

  if (command === 'select-latest-successful-run' && options.runsFile) {
    const payload = readJsonFile(options.runsFile);
    const run = selectLatestSuccessfulWorkflowRun(payload);
    writeOutputs({ run_id: run.id, head_sha: normalizeWorkflowRunHeadSha(run) });
    return;
  }

  if (command === 'manifest-outputs' && options.file) {
    if (!options.sha) {
      printUsage();
      process.exit(1);
    }

    const parsedManifest = parseReleaseCandidateManifest(readFileSync(options.file, 'utf8'), {
      sha: options.sha,
    });

    writeOutputs(buildReleaseManifestOutputs(parsedManifest));
    return;
  }

  printUsage();
  process.exit(1);
}

export * from './lib/release-images.mjs';

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
