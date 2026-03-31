import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  parseReleaseCandidateManifest,
  selectLatestSuccessfulWorkflowRun,
} from './release-images.mjs';

function listReleaseCandidateRuns(repo) {
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

function downloadReleaseCandidateManifest({ repo, runId, sha }) {
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

function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required');
  }

  const runs = listReleaseCandidateRuns(repo);
  const run = selectLatestSuccessfulWorkflowRun(runs);
  const sha = String(run.headSha ?? run.head_sha ?? '').trim();
  if (!sha) {
    throw new Error('Latest successful release candidate run is missing headSha');
  }

  const { artifactDir, manifestPath } = downloadReleaseCandidateManifest({
    repo,
    runId: run.id,
    sha,
  });

  try {
    const manifest = parseReleaseCandidateManifest(readFileSync(manifestPath, 'utf8'), { sha });
    writeOutputs({
      run_id: String(run.id),
      head_sha: sha,
      gateway_image: manifest.gatewayImage,
      migrations_image: manifest.migrationsImage,
      openpath_api_image: manifest.openpathApiImage,
      spa_image: manifest.spaImage,
      verifier_image: manifest.verifierImage,
    });
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
