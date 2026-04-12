import {
  buildLatestVerifierImageOutputs,
  listReleaseCandidateRuns,
  readLatestReleaseCandidateManifest,
  resolveLatestVerifierImageData,
} from './lib/resolve-latest-verifier-image.mjs';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required');
  }

  const runs = listReleaseCandidateRuns(repo);
  const releaseCandidate = readLatestReleaseCandidateManifest({ repo, runs });
  const outputs = buildLatestVerifierImageOutputs(resolveLatestVerifierImageData(releaseCandidate));

  for (const [key, value] of Object.entries(outputs)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
