import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  parseReleaseCandidateManifest,
  selectLatestSuccessfulWorkflowRun,
} from './release-images.mjs';

export function listReleaseCandidateRuns(repo) {
  const output = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      'release-candidate-images.yml',
      '--branch',
      'main',
      '--limit',
      '30',
      '--json',
      'databaseId,headSha,status,conclusion,event,createdAt,updatedAt',
    ],
    { encoding: 'utf8' }
  ).trim();

  return JSON.parse(output || '[]');
}

export function downloadReleaseCandidateManifest({ repo, runId, sha }) {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-candidate-'));

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
        `release-candidate-images-${sha}`,
        '--dir',
        artifactDir,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    return {
      artifactDir,
      manifestPath: resolve(artifactDir, 'release-candidate-images.env'),
    };
  } catch (error) {
    rmSync(artifactDir, { recursive: true, force: true });
    throw error;
  }
}

export function resolveLatestVerifierImageData({ manifestContent, runs }) {
  const run = selectLatestSuccessfulWorkflowRun(runs);
  const headSha = String(run.headSha ?? run.head_sha ?? '').trim();
  if (!headSha) {
    throw new Error('Latest successful release candidate run is missing headSha');
  }

  return {
    manifest: parseReleaseCandidateManifest(manifestContent, { sha: headSha }),
    headSha,
    runId: String(run.id),
  };
}

export function buildLatestVerifierImageOutputs({ manifest, headSha, runId }) {
  return {
    gateway_image: manifest.gatewayImage,
    head_sha: headSha,
    linux_agent_version: manifest.linuxAgentVersion,
    migrations_image: manifest.migrationsImage,
    openpath_api_image: manifest.openpathApiImage,
    run_id: String(runId),
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };
}

export function resolveLatestSuccessfulRun(runs) {
  const run = selectLatestSuccessfulWorkflowRun(runs);
  const headSha = String(run.headSha ?? run.head_sha ?? '').trim();
  if (!headSha) {
    throw new Error('Latest successful release candidate run is missing headSha');
  }

  return {
    headSha,
    runId: Number(run.id),
  };
}

export function readLatestReleaseCandidateManifest({ repo, runs }) {
  const { headSha, runId } = resolveLatestSuccessfulRun(runs);

  const { artifactDir, manifestPath } = downloadReleaseCandidateManifest({
    repo,
    runId,
    sha: headSha,
  });

  try {
    return {
      headSha,
      manifestContent: readFileSync(manifestPath, 'utf8'),
      runId: String(runId),
    };
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
}
