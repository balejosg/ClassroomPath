/**
 * Library: resolves the latest verifier image tag by scanning GHCR release-candidate runs and reading manifests.
 *
 * Invoked by: Imported by `scripts/resolve-latest-verifier-image.mjs`; tested by `resolve-latest-verifier-image.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { listGitHubWorkflowRuns } from './github-actions-artifacts.mjs';
import { readLatestSuccessfulReleaseCandidateManifest } from './release-candidate.mjs';
import { validateWindowsOfflineInstallerTemplatePin } from '../resolve-windows-offline-installer-template-pin.mjs';

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
  const outputs = {
    gateway_image: manifest.gatewayImage,
    head_sha: headSha,
    openpath_version: manifest.openpathVersion,
    linux_agent_version: manifest.linuxAgentVersion,
    linux_agent_apt_suite: manifest.linuxAgentAptSuite,
    migrations_image: manifest.migrationsImage,
    openpath_firefox_assets_image: manifest.openpathFirefoxAssetsImage,
    openpath_api_image: manifest.openpathApiImage,
    run_id: String(runId),
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };

  const windowsPin = {
    version: manifest.windowsOfflineInstallerTemplateVersion,
    commit: manifest.windowsOfflineInstallerTemplateCommit,
    releaseTag: manifest.windowsOfflineInstallerTemplateReleaseTag,
    sha256: manifest.windowsOfflineInstallerTemplateSha256,
  };
  if (Object.values(windowsPin).some((value) => String(value ?? '').trim())) {
    const validatedWindowsPin = validateWindowsOfflineInstallerTemplatePin(windowsPin, {
      context: 'Latest release candidate Windows offline installer pin',
    });
    Object.assign(outputs, {
      windows_offline_installer_template_version: validatedWindowsPin.version,
      windows_offline_installer_template_commit: validatedWindowsPin.commit,
      windows_offline_installer_template_release_tag: validatedWindowsPin.releaseTag,
      windows_offline_installer_template_sha256: validatedWindowsPin.sha256,
    });
  }

  return outputs;
}

export function readLatestReleaseCandidateManifest({ repo, runs, cwd } = {}) {
  return readLatestSuccessfulReleaseCandidateManifest({
    repository: repo,
    runs,
    cwd,
  });
}
