import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function listGitHubWorkflowRuns({ repo, workflow, sha, cwd, limit = 30 }) {
  const args = [
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    workflow,
    '--limit',
    String(limit),
    '--json',
    'databaseId,headSha,status,conclusion,event,createdAt,updatedAt',
  ];

  if (sha) {
    args.splice(8, 0, '--commit', sha);
  }

  const output = execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  return JSON.parse(output || '[]');
}

export function listGitHubArtifacts({ repo, artifactName, cwd, perPage = 100 }) {
  const output = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/actions/artifacts?per_page=${String(perPage)}&name=${encodeURIComponent(artifactName)}`,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  ).trim();

  return JSON.parse(output || '{"artifacts":[]}');
}

export function createTemporaryArtifactDir(prefix = 'classroompath-artifact-') {
  return mkdtempSync(resolve(tmpdir(), prefix));
}

export function cleanupTemporaryArtifactDir(artifactDir) {
  if (!artifactDir) {
    return;
  }

  rmSync(artifactDir, { recursive: true, force: true });
}

export function downloadRunArtifact({ repo, runId, artifactName, cwd, tempPrefix } = {}) {
  const artifactDir = createTemporaryArtifactDir(tempPrefix);

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

    return { artifactDir };
  } catch (error) {
    cleanupTemporaryArtifactDir(artifactDir);
    throw error;
  }
}

export function tryDownloadRunArtifact({ repo, runId, artifactName, cwd, tempPrefix } = {}) {
  try {
    return {
      found: true,
      ...downloadRunArtifact({ repo, runId, artifactName, cwd, tempPrefix }),
    };
  } catch {
    return {
      found: false,
      artifactDir: null,
    };
  }
}

export function downloadArtifactById({ repo, artifactId, cwd, tempPrefix } = {}) {
  const artifactDir = createTemporaryArtifactDir(tempPrefix);
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

    return { artifactDir };
  } catch (error) {
    cleanupTemporaryArtifactDir(artifactDir);
    throw error;
  }
}

export function readArtifactTextFile({ artifactDir, fileName }) {
  return readFileSync(resolve(artifactDir, fileName), 'utf8');
}

export function copyArtifactContents({ artifactDir, outputDir }) {
  mkdirSync(outputDir, { recursive: true });
  for (const entry of readdirSync(artifactDir)) {
    cpSync(resolve(artifactDir, entry), resolve(outputDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

export function waitForArtifactResolution({
  timeoutSeconds = 900,
  intervalSeconds = 10,
  attempt,
  formatTimeoutError,
} = {}) {
  if (typeof attempt !== 'function') {
    throw new Error('Artifact resolution attempt callback is required');
  }

  if (typeof formatTimeoutError !== 'function') {
    throw new Error('Artifact timeout formatter is required');
  }

  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  let timeoutContext = {};

  while (true) {
    const result = attempt(timeoutContext) ?? { status: 'pending' };

    if (result.status === 'resolved') {
      return result.value;
    }

    timeoutContext = result.context ?? timeoutContext;

    if (Date.now() >= deadline) {
      throw new Error(formatTimeoutError(timeoutContext));
    }

    sleep(intervalMs);
  }
}
