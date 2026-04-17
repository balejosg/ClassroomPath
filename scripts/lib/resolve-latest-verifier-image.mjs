import { listGitHubWorkflowRuns } from './github-actions-artifacts.mjs';
import { readLatestSuccessfulReleaseCandidateManifest } from './release-candidate.mjs';

export function listReleaseCandidateRuns(repo, { cwd } = {}) {
  return listGitHubWorkflowRuns({
    repo,
    workflow: 'release-candidate-images.yml',
    cwd,
  });
}

export function resolveLatestVerifierImageData(releaseCandidate) {
  const headSha = String(releaseCandidate?.headSha ?? '').trim();
  if (!headSha) {
    throw new Error('Latest successful release candidate run is missing headSha');
  }

  const runId = String(releaseCandidate?.runId ?? '').trim();
  if (!runId) {
    throw new Error('Latest successful release candidate run is missing runId');
  }

  if (!releaseCandidate?.manifest) {
    throw new Error('Latest successful release candidate manifest is missing manifest data');
  }

  return {
    manifest: releaseCandidate.manifest,
    headSha,
    runId,
  };
}

export function buildLatestVerifierImageOutputs({ manifest, headSha, runId }) {
  return {
    gateway_image: manifest.gatewayImage,
    head_sha: headSha,
    openpath_version: manifest.openpathVersion,
    linux_agent_version: manifest.linuxAgentVersion,
    linux_agent_apt_suite: manifest.linuxAgentAptSuite,
    migrations_image: manifest.migrationsImage,
    openpath_api_image: manifest.openpathApiImage,
    run_id: String(runId),
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };
}

export function readLatestReleaseCandidateManifest({ repo, runs, cwd } = {}) {
  return readLatestSuccessfulReleaseCandidateManifest({
    repository: repo,
    runs,
    cwd,
  });
}
