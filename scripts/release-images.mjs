import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isDirectExecution,
  normalizeWorkflowRunHeadSha,
  readJsonFile,
  writeOutputs,
} from './lib/github-actions.mjs';
import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';
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
  return parseCommandLine(argv, {
    valueFlags: ['--file', '--owner', '--runs-file', '--sha'],
  });
}

export function runReleaseImagesCli(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);

  if (command === 'outputs') {
    const sha = requireCliOption(options, 'sha', 'Usage error: --sha is required for outputs');
    const refs = deriveTaggedImageRefs({
      sha,
      repositoryOwner: options.owner ?? process.env.GITHUB_REPOSITORY_OWNER,
      repository: process.env.GITHUB_REPOSITORY,
      cwd: projectRoot,
    });

    writeOutputs(buildReleaseImageOutputs(refs));
    return;
  }

  if (command === 'select-run-id' && options.runsFile) {
    const sha = requireCliOption(
      options,
      'sha',
      'Usage error: --sha is required for select-run-id'
    );
    const payload = readJsonFile(options.runsFile);
    const run = selectSuccessfulReleaseCandidateRun(payload, { sha });
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
    const sha = requireCliOption(
      options,
      'sha',
      'Usage error: --sha is required for manifest-outputs'
    );
    const parsedManifest = parseReleaseCandidateManifest(readFileSync(options.file, 'utf8'), {
      sha,
    });

    writeOutputs(buildReleaseManifestOutputs(parsedManifest));
    return;
  }

  printUsage();
  return 1;
}

export * from './lib/release-images.mjs';

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli(runReleaseImagesCli);
}
