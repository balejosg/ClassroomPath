import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  normalizeWorkflowRunId,
  normalizeWorkflowRunUpdatedAt,
  resolveArtifactRunId,
  serializeOutputs,
  sortArtifactsNewestFirst,
  sortWorkflowRunsNewestFirst,
} from './github-actions.mjs';
import {
  detectRepositorySlug,
  parseReleaseCandidateManifest,
  selectLatestReleaseCandidateRun,
} from './release-images.mjs';

export function buildReleaseCandidateManifestOutputs({ repository, runId, manifest }) {
  return {
    repository,
    run_id: runId,
    app_sha: manifest.appSha,
    gateway_image: manifest.gatewayImage,
    migrations_image: manifest.migrationsImage,
    openpath_api_image: manifest.openpathApiImage,
    openpath_version: manifest.openpathVersion,
    linux_agent_version: manifest.linuxAgentVersion,
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };
}

export function formatWorkflowRunContext(run) {
  if (!run) {
    return 'none';
  }

  const details = [];
  const runId = normalizeWorkflowRunId(run);
  const updatedAt = normalizeWorkflowRunUpdatedAt(run);

  if (runId) {
    details.push(`run_id=${runId}`);
  }

  details.push(`status=${run?.status ?? 'unknown'}`);

  if (run?.conclusion) {
    details.push(`conclusion=${run.conclusion}`);
  }

  if (updatedAt) {
    details.push(`updated_at=${updatedAt}`);
  }

  return `{${details.join(', ')}}`;
}

export function formatReleaseCandidateRunFailure({ targetSha, run }) {
  return `Release candidate workflow run for SHA ${targetSha} failed (${formatWorkflowRunContext(run)})`;
}

export function formatFirefoxReleaseAssetsTimeoutError({
  artifactName,
  latestRun,
  lastSuccessfulRunWithoutArtifact,
}) {
  const details = [`latest_run=${formatWorkflowRunContext(latestRun)}`];

  if (lastSuccessfulRunWithoutArtifact) {
    details.push(
      `last_success_without_artifact=${formatWorkflowRunContext(lastSuccessfulRunWithoutArtifact)}`
    );
  }

  return `Timed out waiting for Firefox release assets artifact ${artifactName} (workflow=firefox-release-assets.yml; ${details.join('; ')})`;
}

export function selectLatestArtifact(payload, { artifactName } = {}) {
  const targetArtifactName = String(artifactName ?? '').trim();
  if (!targetArtifactName) {
    throw new Error('Artifact name is required');
  }

  const selected = sortArtifactsNewestFirst(payload).filter((artifact) => {
    if (!artifact || artifact.expired === true) {
      return false;
    }

    return String(artifact.name ?? '').trim() === targetArtifactName;
  })[0];

  if (!selected) {
    throw new Error(`No artifact found with name ${targetArtifactName}`);
  }

  return selected;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function selectLatestWorkflowRun(payload) {
  return (
    sortWorkflowRunsNewestFirst(payload).find((run) => {
      return Boolean(run && normalizeWorkflowRunId(run));
    }) ?? null
  );
}

function resolveLatestReleaseCandidateState(payload, { sha }) {
  try {
    const run = selectLatestReleaseCandidateRun(payload, { sha });

    if (run.status === 'completed' && run.conclusion === 'success') {
      return { state: 'success', run };
    }

    if (run.status === 'completed') {
      return { state: 'failed', run };
    }

    return { state: 'pending', run };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('No release candidate workflow run found')
    ) {
      return { state: 'missing', run: null };
    }

    throw error;
  }
}

function listWorkflowRuns({ repo, workflow, sha, cwd }) {
  const args = [
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    workflow,
    '--limit',
    '30',
    '--json',
    'databaseId,headSha,status,conclusion,event,createdAt,updatedAt',
  ];

  if (sha) {
    args.splice(8, 0, '--commit', sha);
  }

  const output = execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
  }).trim();

  return JSON.parse(output || '[]');
}

function listArtifacts({ repo, artifactName, cwd }) {
  const output = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/actions/artifacts?per_page=100&name=${encodeURIComponent(artifactName)}`,
    ],
    {
      cwd,
      encoding: 'utf8',
    }
  ).trim();

  return JSON.parse(output || '{"artifacts":[]}');
}

function downloadManifest({ repo, runId, sha, cwd }) {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-candidate-'));

  execFileSync(
    'gh',
    [
      'run',
      'download',
      String(runId),
      '--repo',
      repo,
      '--name',
      `release-candidate-images-${sha}`,
      '--dir',
      artifactDir,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return {
    artifactDir,
    manifestPath: resolve(artifactDir, 'release-candidate-images.env'),
  };
}

function downloadArtifactById({ repo, artifactId, cwd }) {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-candidate-'));
  const artifactArchivePath = resolve(artifactDir, 'artifact.zip');

  try {
    const artifactZip = execFileSync(
      'gh',
      ['api', `repos/${repo}/actions/artifacts/${artifactId}/zip`],
      {
        cwd,
        encoding: null,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    writeFileSync(artifactArchivePath, artifactZip);
    execFileSync('unzip', ['-oq', artifactArchivePath, '-d', artifactDir], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      artifactDir,
      manifestPath: resolve(artifactDir, 'release-candidate-images.env'),
    };
  } catch (error) {
    rmSync(artifactDir, { recursive: true, force: true });
    throw error;
  }
}

function downloadReleaseCandidateArtifact({ repo, artifact, sha, cwd }) {
  const runId = resolveArtifactRunId(artifact);
  if (runId) {
    return {
      ...downloadManifest({ repo, runId, sha, cwd }),
      runId,
    };
  }

  if (!artifact?.id) {
    throw new Error(
      `Release candidate artifact for SHA ${sha} is missing both workflow_run.id and id`
    );
  }

  return {
    ...downloadArtifactById({ repo, artifactId: artifact.id, cwd }),
    runId: null,
  };
}

function tryDownloadArtifact({ repo, runId, artifactName, cwd }) {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'classroompath-artifact-'));

  try {
    execFileSync(
      'gh',
      [
        'run',
        'download',
        String(runId),
        '--repo',
        repo,
        '--name',
        artifactName,
        '--dir',
        artifactDir,
      ],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    return {
      found: true,
      artifactDir,
    };
  } catch {
    rmSync(artifactDir, { recursive: true, force: true });
    return {
      found: false,
      artifactDir: null,
    };
  }
}

export function waitForReleaseCandidateManifest({
  sha,
  repository,
  timeoutSeconds = 900,
  intervalSeconds = 10,
  outputFile,
  cwd,
} = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to resolve a release candidate manifest');
  }

  const repo = detectRepositorySlug({ repository, cwd });
  const artifactName = `release-candidate-images-${targetSha}`;
  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  let lastState = 'missing';
  let latestRun = null;

  while (true) {
    const artifactsPayload = listArtifacts({ repo, artifactName, cwd });

    try {
      const artifact = selectLatestArtifact(artifactsPayload, { artifactName });
      const { artifactDir, manifestPath, runId } = downloadReleaseCandidateArtifact({
        repo,
        artifact,
        sha: targetSha,
        cwd,
      });

      try {
        const manifest = parseReleaseCandidateManifest(
          execFileSync('cat', [manifestPath], { encoding: 'utf8' }),
          { sha: targetSha }
        );

        if (outputFile) {
          writeFileSync(
            outputFile,
            `${serializeOutputs(
              buildReleaseCandidateManifestOutputs({
                repository: repo,
                runId,
                manifest,
              })
            )}\n`,
            'utf8'
          );
        }

        return { repository: repo, runId, manifest };
      } finally {
        rmSync(artifactDir, { recursive: true, force: true });
      }
    } catch (artifactError) {
      if (
        !(artifactError instanceof Error) ||
        !artifactError.message.includes(`No artifact found with name ${artifactName}`)
      ) {
        throw artifactError;
      }
    }

    const payload = listWorkflowRuns({
      repo,
      workflow: 'release-candidate-images.yml',
      sha: targetSha,
      cwd,
    });
    const { state, run } = resolveLatestReleaseCandidateState(payload, { sha: targetSha });
    lastState = state;
    latestRun = run;

    if (state === 'failed' && run) {
      throw new Error(formatReleaseCandidateRunFailure({ targetSha, run }));
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for a successful release candidate manifest for SHA ${targetSha} (last_state=${lastState}; latest_run=${formatWorkflowRunContext(latestRun)})`
      );
    }

    sleep(intervalMs);
  }
}

export function waitForFirefoxReleaseAssets({
  openpathSha,
  repository,
  timeoutSeconds = 900,
  intervalSeconds = 10,
  outputDir,
  cwd,
} = {}) {
  const targetOpenpathSha = String(openpathSha ?? '').trim();
  if (!targetOpenpathSha) {
    throw new Error('OpenPath SHA is required to resolve Firefox release assets');
  }

  const repo = detectRepositorySlug({ repository, cwd });
  const artifactName = `openpath-firefox-release-assets-${targetOpenpathSha}`;
  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  let latestRun = null;
  let lastSuccessfulRunWithoutArtifact = null;

  while (true) {
    const payload = listWorkflowRuns({
      repo,
      workflow: 'firefox-release-assets.yml',
      cwd,
    });

    latestRun = selectLatestWorkflowRun(payload);
    lastSuccessfulRunWithoutArtifact = null;

    for (const run of sortWorkflowRunsNewestFirst(payload)) {
      if (run.status !== 'completed' || run.conclusion !== 'success') {
        continue;
      }

      const runId = normalizeWorkflowRunId(run);
      if (!runId) {
        continue;
      }

      const download = tryDownloadArtifact({ repo, runId, artifactName, cwd });

      if (!download.found || !download.artifactDir) {
        if (!lastSuccessfulRunWithoutArtifact) {
          lastSuccessfulRunWithoutArtifact = run;
        }
        continue;
      }

      try {
        if (outputDir) {
          mkdirSync(outputDir, { recursive: true });
          for (const entry of readdirSync(download.artifactDir)) {
            cpSync(resolve(download.artifactDir, entry), resolve(outputDir, entry), {
              recursive: true,
              force: true,
            });
          }
        }

        return {
          repository: repo,
          runId,
          artifactName,
        };
      } finally {
        rmSync(download.artifactDir, { recursive: true, force: true });
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        formatFirefoxReleaseAssetsTimeoutError({
          artifactName,
          latestRun,
          lastSuccessfulRunWithoutArtifact,
        })
      );
    }

    sleep(intervalMs);
  }
}
