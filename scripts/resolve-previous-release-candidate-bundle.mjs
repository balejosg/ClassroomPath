#!/usr/bin/env node

import {
  buildReleaseCandidateBundleProjectionOutputs,
  resolvePreviousReleaseCandidateBundle,
} from './lib/release-candidate-bundle.mjs';

function parseArgs(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY?.trim() ?? '',
    currentSha: process.env.CLASSROOMPATH_SHA?.trim() || process.env.GITHUB_SHA?.trim() || '',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--repo') {
      options.repository = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--classroompath-sha') {
      options.currentSha = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    throw new Error('Unknown argument: ' + token);
  }
  return options;
}

export function runPreviousReleaseCandidateBundleResolver(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const resolved = resolvePreviousReleaseCandidateBundle({
    repository: options.repository,
    currentClassroomPathSha: options.currentSha || undefined,
  });
  const output = {
    ...buildReleaseCandidateBundleProjectionOutputs(resolved),
    previous_run_id: resolved.runId,
    previous_head_sha: resolved.headSha,
    release_bundle_artifact: resolved.artifactName,
  };
  process.stdout.write(
    (options.json
      ? JSON.stringify(output)
      : Object.entries(output)
          .map(([key, value]) => key + '=' + value)
          .join('\n')) + '\n'
  );
  return { ...resolved, output };
}

if (process.argv[1] && process.argv[1].endsWith('resolve-previous-release-candidate-bundle.mjs')) {
  runPreviousReleaseCandidateBundleResolver();
}
