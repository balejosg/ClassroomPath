/**
 * Exact Release Bundle v2 locators and projections used by RC reuse and promotion.
 *
 * The OpenPath contract is resolved independently from this module. This module
 * only accepts a bundle artifact belonging to the requested ClassroomPath SHA;
 * it never selects a latest tag or composes a release from component metadata.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  cleanupTemporaryArtifactDir,
  downloadArtifactById,
  listGitHubArtifacts,
  listGitHubWorkflowRuns,
  waitForArtifactResolution,
} from './github-actions-artifacts.mjs';
import {
  projectReleaseBundleToRuntimeEnv,
  verifyReleaseBundleArtifacts,
} from './release-bundle.mjs';
import {
  buildCanonicalReleaseManifestFromBundle,
  serializeReleaseManifest,
} from './release-manifest.mjs';

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertSha40(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SHA40_PATTERN.test(normalized)) {
    throw new Error(label + ' must be a 40-character lowercase SHA');
  }
  return normalized;
}

function assertSha256(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(label + ' must be a 64-character lowercase SHA-256 hex string');
  }
  return normalized;
}

export function buildReleaseCandidateBundleArtifactName(classroomPathSha) {
  return 'release-bundle-' + assertSha40(classroomPathSha, 'ClassroomPath SHA');
}

function runIdOf(run) {
  const value = run?.databaseId ?? run?.runId ?? run?.id;
  return String(value ?? '').trim();
}

function headShaOf(run) {
  return String(run?.headSha ?? run?.head_sha ?? '').trim();
}

function updatedAtOf(run) {
  return String(run?.updatedAt ?? run?.updated_at ?? run?.createdAt ?? '').trim();
}

function successfulExactReleaseCandidateRuns(runs, classroomPathSha, { runId } = {}) {
  const targetSha = assertSha40(classroomPathSha, 'ClassroomPath SHA');
  const requestedRunId = runId === undefined ? '' : String(runId).trim();

  return (Array.isArray(runs) ? runs : [])
    .filter(
      (run) =>
        run &&
        headShaOf(run) === targetSha &&
        (!requestedRunId || runIdOf(run) === requestedRunId) &&
        String(run.event ?? '').trim() === 'push' &&
        String(run.status ?? '').trim() === 'completed' &&
        String(run.conclusion ?? '').trim() === 'success' &&
        runIdOf(run)
    )
    .sort((left, right) => updatedAtOf(right).localeCompare(updatedAtOf(left)));
}

/**
 * Selects the successful workflow run for one exact ClassroomPath SHA.
 * The target SHA is the only default selection key; an optional exact run ID
 * can further pin the locator recorded by promotion evidence. No ancestor or
 * latest fallback is accepted.
 */
export function selectExactReleaseCandidateRun(runs, classroomPathSha, { runId } = {}) {
  const targetSha = assertSha40(classroomPathSha, 'ClassroomPath SHA');
  const requestedRunId = runId === undefined ? '' : String(runId).trim();
  const candidates = successfulExactReleaseCandidateRuns(runs, targetSha, {
    runId: requestedRunId,
  });

  if (candidates.length === 0) {
    const locator = requestedRunId ? ` and run ID ${requestedRunId}` : '';
    throw new Error(
      'No successful release candidate run exists for exact SHA ' + targetSha + locator
    );
  }

  return candidates[0];
}

function artifactBelongsToRun(artifact, run) {
  const artifactRunId = String(
    artifact?.workflow_run?.id ?? artifact?.workflowRun?.id ?? artifact?.runId ?? ''
  ).trim();
  if (!run) return true;
  return Boolean(artifactRunId) && artifactRunId === runIdOf(run);
}

export function selectExactReleaseBundleArtifact(artifacts, { classroomPathSha, run } = {}) {
  const artifactName = buildReleaseCandidateBundleArtifactName(classroomPathSha);
  const artifactList = Array.isArray(artifacts) ? artifacts : artifacts?.artifacts;
  const selected = (Array.isArray(artifactList) ? artifactList : []).find(
    (artifact) =>
      artifact &&
      artifact.name === artifactName &&
      artifact.expired !== true &&
      artifactBelongsToRun(artifact, run)
  );
  if (!selected) {
    throw new Error(
      'No unexpired Release Bundle v2 artifact exists for exact SHA ' + classroomPathSha
    );
  }
  return selected;
}

/**
 * Verifies downloaded bundle/contract bytes and returns the only acceptable
 * runtime projection. Callers must provide the exact artifact bytes.
 */
export function readReleaseCandidateBundleArtifacts({
  bundleBytes,
  contractBytes,
  classroomPathSha,
  releaseId,
} = {}) {
  const verified = verifyReleaseBundleArtifacts({
    bundleBytes,
    contractBytes,
    expectedClassroomPathSha:
      classroomPathSha === undefined
        ? undefined
        : assertSha40(classroomPathSha, 'ClassroomPath SHA'),
    expectedReleaseId: releaseId === undefined ? undefined : assertSha256(releaseId, 'releaseId'),
  });
  return {
    ...verified,
    artifactName: buildReleaseCandidateBundleArtifactName(verified.bundle.classroomPathSha),
  };
}

export function readReleaseCandidateBundleFromFiles({
  bundlePath,
  contractPath,
  classroomPathSha,
  releaseId,
} = {}) {
  return readReleaseCandidateBundleArtifacts({
    bundleBytes: readFileSync(bundlePath),
    contractBytes: readFileSync(contractPath),
    classroomPathSha,
    releaseId,
  });
}

export function buildReleaseCandidateBundleRuntimeProjection({
  bundle,
  contract,
  releaseId,
  imageSource = 'release-candidate',
} = {}) {
  return projectReleaseBundleToRuntimeEnv({
    bundle,
    contract,
    releaseId: releaseId === undefined ? undefined : assertSha256(releaseId, 'releaseId'),
    imageSource,
  });
}

export function buildReleaseCandidateBundleRuntimeProjectionFromFiles({
  bundlePath,
  contractPath,
  classroomPathSha,
  releaseId,
  imageSource = 'release-candidate',
} = {}) {
  const verified = readReleaseCandidateBundleFromFiles({
    bundlePath,
    contractPath,
    classroomPathSha,
    releaseId,
  });
  return {
    verified,
    runtime: buildReleaseCandidateBundleRuntimeProjection({
      bundle: verified.bundle,
      contract: verified.contract,
      releaseId: verified.releaseId,
      imageSource,
    }),
  };
}

function artifactIdOf(artifact) {
  const value = artifact?.id ?? artifact?.databaseId;
  return String(value ?? '').trim();
}

export function readArtifactFile({ artifactDir, fileName }) {
  return readFileSync(resolvePath(artifactDir, fileName));
}

const RELEASE_BUNDLE_LAYOUTS = [
  { name: 'release-bundle', prefix: 'release-bundle' },
  { name: 'root', prefix: '' },
];

const RELEASE_BUNDLE_FILE_NAMES = {
  bundle: 'classroompath-release-bundle.json',
  contract: 'openpath-promotion-contract.json',
};

function readArtifactLayoutFile(readBytes, { artifactDir, prefix, fileName }) {
  const layoutFileName = prefix ? `${prefix}/${fileName}` : fileName;
  try {
    return Buffer.from(readBytes({ artifactDir, fileName: layoutFileName }));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function readBundleFilesFromArtifact({ artifactDir, readFile, readTextFile }) {
  const readBytes =
    typeof readFile === 'function'
      ? readFile
      : typeof readTextFile === 'function'
        ? ({ artifactDir: directory, fileName }) =>
            Buffer.from(readTextFile({ artifactDir: directory, fileName }), 'utf8')
        : readArtifactFile;

  const completePairs = [];
  for (const layout of RELEASE_BUNDLE_LAYOUTS) {
    const bundleBytes = readArtifactLayoutFile(readBytes, {
      artifactDir,
      prefix: layout.prefix,
      fileName: RELEASE_BUNDLE_FILE_NAMES.bundle,
    });
    const contractBytes = readArtifactLayoutFile(readBytes, {
      artifactDir,
      prefix: layout.prefix,
      fileName: RELEASE_BUNDLE_FILE_NAMES.contract,
    });
    if (bundleBytes !== null && contractBytes !== null) {
      completePairs.push({ layout: layout.name, bundleBytes, contractBytes });
    }
  }

  if (completePairs.length === 0) {
    throw new Error('No complete Release Bundle v2 file pair exists in the artifact');
  }

  const [canonicalPair, compatibilityPair] = completePairs;
  if (
    compatibilityPair &&
    (!canonicalPair.bundleBytes.equals(compatibilityPair.bundleBytes) ||
      !canonicalPair.contractBytes.equals(compatibilityPair.contractBytes))
  ) {
    throw new Error(
      'Ambiguous Release Bundle v2 artifact: complete release-bundle and root pairs differ'
    );
  }

  return {
    bundleBytes: canonicalPair.bundleBytes,
    contractBytes: canonicalPair.contractBytes,
  };
}

export function resolveExactReleaseCandidateBundle({
  repository,
  classroomPathSha,
  releaseId,
  runId: requestedRunId,
  run,
  runs,
  artifacts,
  cwd,
  listRuns = listGitHubWorkflowRuns,
  listArtifacts = listGitHubArtifacts,
  downloadArtifact = downloadArtifactById,
  readFile,
  readTextFile,
} = {}) {
  const targetSha = assertSha40(classroomPathSha, 'ClassroomPath SHA');
  const repo = String(repository ?? '').trim();
  if (!repo) throw new Error('GitHub repository is required to resolve a Release Bundle v2');
  const availableRuns =
    runs ?? listRuns({ repo, workflow: 'release-candidate-images.yml', sha: targetSha, cwd });
  const candidateRuns = run
    ? [run]
    : releaseId !== undefined
      ? successfulExactReleaseCandidateRuns(availableRuns, targetSha, {
          runId: requestedRunId,
        })
      : [
          selectExactReleaseCandidateRun(availableRuns, targetSha, {
            runId: requestedRunId,
          }),
        ];

  if (candidateRuns.length === 0) {
    const locator = requestedRunId ? ` and run ID ${requestedRunId}` : '';
    throw new Error(
      'No successful release candidate run exists for exact SHA ' + targetSha + locator
    );
  }

  const artifactName = buildReleaseCandidateBundleArtifactName(targetSha);
  let lastReleaseIdMismatch = null;

  for (const selectedRun of candidateRuns) {
    if (headShaOf(selectedRun) !== targetSha) {
      throw new Error('Release candidate run head SHA does not match exact SHA ' + targetSha);
    }
    const selectedRunId = runIdOf(selectedRun);
    if (!selectedRunId) throw new Error('Release candidate run is missing its run ID');

    let selectedArtifact;
    try {
      selectedArtifact = selectExactReleaseBundleArtifact(
        artifacts ?? listArtifacts({ repo, artifactName, cwd }),
        { classroomPathSha: targetSha, run: selectedRun }
      );
    } catch (error) {
      if (releaseId !== undefined && !run) {
        continue;
      }
      throw error;
    }

    const artifactId = artifactIdOf(selectedArtifact);
    if (!artifactId) throw new Error('Release Bundle v2 artifact is missing its artifact ID');
    const downloaded = downloadArtifact({
      repo,
      artifactId,
      cwd,
      tempPrefix: 'classroompath-release-bundle-',
    });
    const artifactDir = downloaded?.artifactDir ?? downloaded;
    try {
      const verified = readReleaseCandidateBundleArtifacts({
        ...readBundleFilesFromArtifact({ artifactDir, readFile, readTextFile }),
        classroomPathSha: targetSha,
        releaseId,
      });
      return {
        repository: repo,
        runId: selectedRunId,
        headSha: targetSha,
        artifactName,
        artifactId,
        ...verified,
        runtime: buildReleaseCandidateBundleRuntimeProjection({
          bundle: verified.bundle,
          contract: verified.contract,
          releaseId: verified.releaseId,
        }),
      };
    } catch (error) {
      if (
        releaseId !== undefined &&
        !run &&
        error instanceof Error &&
        error.message.includes('does not match expected releaseId')
      ) {
        lastReleaseIdMismatch = error;
        continue;
      }
      throw error;
    } finally {
      if (downloaded?.cleanup) {
        downloaded.cleanup();
      } else if (artifactDir) {
        cleanupTemporaryArtifactDir(artifactDir);
      }
    }
  }

  if (lastReleaseIdMismatch) {
    throw new Error(
      'No Release Bundle v2 for exact SHA ' + targetSha + ' matches expected releaseId ' + releaseId
    );
  }
  throw new Error('No Release Bundle v2 artifact exists for exact SHA ' + targetSha);
}

export function resolvePreviousReleaseCandidateBundle({
  repository,
  currentClassroomPathSha,
  runs,
  artifactsByRun,
  cwd,
  listRuns = listGitHubWorkflowRuns,
  listArtifacts = listGitHubArtifacts,
  downloadArtifact = downloadArtifactById,
  readFile,
  readTextFile,
} = {}) {
  const repo = String(repository ?? '').trim();
  if (!repo)
    throw new Error('GitHub repository is required to resolve a previous Release Bundle v2');
  const currentSha = currentClassroomPathSha
    ? assertSha40(currentClassroomPathSha, 'current ClassroomPath SHA')
    : '';
  const candidateRuns = (runs ?? listRuns({ repo, workflow: 'release-candidate-images.yml', cwd }))
    .filter((candidate) => headShaOf(candidate) && headShaOf(candidate) !== currentSha)
    .sort((left, right) => updatedAtOf(right).localeCompare(updatedAtOf(left)));

  for (const candidateRun of candidateRuns) {
    if (
      String(candidateRun?.status ?? '').trim() !== 'completed' ||
      String(candidateRun?.conclusion ?? '').trim() !== 'success'
    ) {
      continue;
    }
    const candidateSha = headShaOf(candidateRun);
    const artifactName = buildReleaseCandidateBundleArtifactName(candidateSha);
    let candidateArtifacts = artifactsByRun?.[runIdOf(candidateRun)];
    if (!candidateArtifacts) {
      candidateArtifacts = listArtifacts({ repo, artifactName, cwd });
    }
    let selectedArtifact;
    try {
      selectedArtifact = selectExactReleaseBundleArtifact(candidateArtifacts, {
        classroomPathSha: candidateSha,
        run: candidateRun,
      });
    } catch {
      // Older successful runs may predate Release Bundle v2. They are not a
      // source of release data and may be skipped; a present v2 artifact is
      // always verified strictly below.
      continue;
    }
    return resolveExactReleaseCandidateBundle({
      repository: repo,
      classroomPathSha: candidateSha,
      run: candidateRun,
      artifacts: [selectedArtifact],
      cwd,
      listRuns,
      listArtifacts,
      downloadArtifact,
      readFile,
      readTextFile,
    });
  }

  throw new Error('No previous successful Release Bundle v2 is available');
}

export function buildReleaseCandidateBundleProjectionOutputs(resolved) {
  const runtime = resolved?.runtime;
  if (!runtime) throw new Error('Resolved Release Bundle v2 runtime projection is required');
  return {
    ...runtime,
    release_id: runtime.RELEASE_ID,
    openpath_sha: runtime.OPENPATH_SHA,
    openpath_contract_sha256: runtime.OPENPATH_CONTRACT_SHA256,
    gateway_image: runtime.CLASSROOMPATH_GATEWAY_IMAGE,
    migrations_image: runtime.CLASSROOMPATH_MIGRATIONS_IMAGE,
    openpath_firefox_assets_image: runtime.OPENPATH_FIREFOX_ASSETS_IMAGE,
    openpath_api_image: runtime.OPENPATH_API_IMAGE,
    openpath_version: runtime.OPENPATH_VERSION,
    linux_agent_version: runtime.OPENPATH_LINUX_AGENT_VERSION,
    linux_agent_apt_suite: runtime.OPENPATH_LINUX_AGENT_APT_SUITE,
    spa_image: runtime.CLASSROOMPATH_SPA_IMAGE,
    verifier_image: runtime.CLASSROOMPATH_VERIFIER_IMAGE,
    windows_offline_installer_template_version: runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION,
    windows_offline_installer_template_commit: runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT,
    windows_offline_installer_template_release_tag:
      runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG,
    windows_offline_installer_template_sha256: runtime.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256,
  };
}

export function writeReleaseCandidateBundleRuntimeEnv(outputPath, runtime) {
  const path = String(outputPath ?? '').trim();
  if (!path) throw new Error('outputPath is required for a Release Bundle runtime projection');
  const values = buildReleaseCandidateBundleProjectionOutputs({ runtime });
  const text =
    Object.entries(values)
      .filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key))
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n';
  writeFileSync(path, text, 'utf8');
  return path;
}

export function writeReleaseCandidateBundleLegacyManifest(outputPath, resolved) {
  const path = String(outputPath ?? '').trim();
  if (!path) throw new Error('outputPath is required for a release manifest projection');
  if (!resolved?.bundle || !resolved?.contractBytes) {
    throw new Error('Resolved Release Bundle and exact contract bytes are required');
  }
  const manifest = buildCanonicalReleaseManifestFromBundle({
    repository: resolved.repository,
    runId: resolved.runId,
    bundle: resolved.bundle,
    contractBytes: resolved.contractBytes,
  });
  writeFileSync(path, serializeReleaseManifest(manifest), 'utf8');
  return path;
}

export function writeResolvedReleaseCandidateBundleArtifacts(outputDir, resolved) {
  const directory = String(outputDir ?? '').trim();
  if (!directory) throw new Error('outputDir is required for Release Bundle artifacts');
  if (!resolved?.bundleBytes || !resolved?.contractBytes) {
    throw new Error('Resolved Release Bundle bytes are required');
  }
  const absoluteDirectory = resolvePath(directory);
  mkdirSync(absoluteDirectory, { recursive: true });
  const bundlePath = resolvePath(absoluteDirectory, 'classroompath-release-bundle.json');
  const contractPath = resolvePath(absoluteDirectory, 'openpath-promotion-contract.json');
  writeFileSync(bundlePath, resolved.bundleBytes);
  writeFileSync(contractPath, resolved.contractBytes);
  return { bundlePath, contractPath };
}

export function waitForExactReleaseCandidateBundle({
  repository,
  classroomPathSha,
  runId,
  releaseId,
  timeoutSeconds = 900,
  intervalSeconds = 10,
  outputFile,
  outputDir,
  legacyManifestFile,
  cwd,
  listRuns = listGitHubWorkflowRuns,
  listArtifacts = listGitHubArtifacts,
  downloadArtifact = downloadArtifactById,
  readFile,
  readTextFile,
} = {}) {
  const targetSha = assertSha40(classroomPathSha, 'ClassroomPath SHA');
  const repo = String(repository ?? '').trim();
  if (!repo) throw new Error('GitHub repository is required to wait for a Release Bundle v2');
  const artifactName = buildReleaseCandidateBundleArtifactName(targetSha);

  return waitForArtifactResolution({
    timeoutSeconds,
    intervalSeconds,
    attempt() {
      const listedRuns = listRuns({
        repo,
        workflow: 'release-candidate-images.yml',
        sha: targetSha,
        cwd,
      });

      if (releaseId !== undefined && runId === undefined) {
        try {
          const resolved = resolveExactReleaseCandidateBundle({
            repository: repo,
            classroomPathSha: targetSha,
            releaseId,
            runs: listedRuns,
            cwd,
            listRuns,
            listArtifacts,
            downloadArtifact,
            readFile,
            readTextFile,
          });
          if (outputFile) {
            writeReleaseCandidateBundleRuntimeEnv(outputFile, resolved.runtime);
          }
          if (legacyManifestFile) {
            writeReleaseCandidateBundleLegacyManifest(legacyManifestFile, resolved);
          }
          if (outputDir) {
            Object.assign(
              resolved,
              writeResolvedReleaseCandidateBundleArtifacts(outputDir, resolved)
            );
          }
          return { status: 'resolved', value: resolved };
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('No successful release candidate run') ||
              error.message.includes('No Release Bundle v2') ||
              error.code === 'ENOENT' ||
              error.status === 404)
          ) {
            return { status: 'pending' };
          }
          throw error;
        }
      }

      let selectedRun;
      try {
        selectedRun = selectExactReleaseCandidateRun(listedRuns, targetSha, { runId });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('No successful release candidate run')
        ) {
          return { status: 'pending' };
        }
        throw error;
      }

      let selectedArtifact;
      try {
        selectedArtifact = selectExactReleaseBundleArtifact(
          listArtifacts({ repo, artifactName, cwd }),
          { classroomPathSha: targetSha, run: selectedRun }
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('No unexpired Release Bundle v2 artifact')
        ) {
          return { status: 'pending' };
        }
        throw error;
      }

      try {
        const resolved = resolveExactReleaseCandidateBundle({
          repository: repo,
          classroomPathSha: targetSha,
          runId,
          run: selectedRun,
          releaseId,
          artifacts: [selectedArtifact],
          cwd,
          listRuns,
          listArtifacts,
          downloadArtifact,
          readFile,
          readTextFile,
        });
        if (outputFile) {
          writeReleaseCandidateBundleRuntimeEnv(outputFile, resolved.runtime);
        }
        if (legacyManifestFile) {
          writeReleaseCandidateBundleLegacyManifest(legacyManifestFile, resolved);
        }
        if (outputDir) {
          Object.assign(
            resolved,
            writeResolvedReleaseCandidateBundleArtifacts(outputDir, resolved)
          );
        }
        return { status: 'resolved', value: resolved };
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.status === 404) {
          return { status: 'pending' };
        }
        throw error;
      }
    },
    formatTimeoutError() {
      const identity = releaseId === undefined ? '' : ' and releaseId ' + releaseId;
      return 'Timed out waiting for an exact Release Bundle v2 for SHA ' + targetSha + identity;
    },
  });
}
