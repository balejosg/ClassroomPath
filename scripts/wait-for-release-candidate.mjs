import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectRepositorySlug,
  parseReleaseCandidateManifest,
  selectLatestReleaseCandidateRun,
} from './release-images.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-manifest --sha <sha> [--repo <owner/repo>] [--timeout-seconds <seconds>] [--interval-seconds <seconds>] [--output-file <path>]'
  );
}

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === '--sha') {
      options.sha = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--repo') {
      options.repo = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--timeout-seconds') {
      options.timeoutSeconds = Number(rest[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--interval-seconds') {
      options.intervalSeconds = Number(rest[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--output-file') {
      options.outputFile = rest[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function listWorkflowRuns({ repo, sha }) {
  const output = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      'release-candidate-images.yml',
      '--commit',
      sha,
      '--limit',
      '20',
      '--json',
      'databaseId,headSha,status,conclusion,event,createdAt,updatedAt',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    }
  ).trim();

  return JSON.parse(output || '[]');
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

function downloadManifest({ repo, runId, sha }) {
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
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return {
    artifactDir,
    manifestPath: resolve(artifactDir, 'release-candidate-images.env'),
  };
}

export function waitForReleaseCandidateManifest({
  sha,
  repository,
  timeoutSeconds = 900,
  intervalSeconds = 10,
  outputFile,
} = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to resolve a release candidate manifest');
  }

  const repo = detectRepositorySlug({
    repository,
    cwd: projectRoot,
  });
  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  let lastState = 'missing';

  while (true) {
    const payload = listWorkflowRuns({ repo, sha: targetSha });
    const { state, run } = resolveLatestReleaseCandidateState(payload, { sha: targetSha });
    lastState = state;

    if (state === 'success' && run) {
      const { artifactDir, manifestPath } = downloadManifest({
        repo,
        runId: run.id,
        sha: targetSha,
      });

      try {
        const manifest = parseReleaseCandidateManifest(
          execFileSync('cat', [manifestPath], { encoding: 'utf8' }),
          { sha: targetSha }
        );

        if (outputFile) {
          copyFileSync(manifestPath, outputFile);
        }

        return {
          repository: repo,
          runId: run.id,
          manifest,
        };
      } finally {
        rmSync(artifactDir, { recursive: true, force: true });
      }
    }

    if (state === 'failed' && run) {
      throw new Error(
        `Release candidate workflow run ${run.id} for SHA ${targetSha} finished with conclusion=${run.conclusion ?? 'unknown'}`
      );
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for a successful release candidate manifest for SHA ${targetSha} (last_state=${lastState})`
      );
    }

    sleep(intervalMs);
  }
}

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

  if (command !== 'resolve-manifest' || !options.sha) {
    printUsage();
    process.exit(1);
  }

  const result = waitForReleaseCandidateManifest({
    sha: options.sha,
    repository: options.repo ?? process.env.GITHUB_REPOSITORY,
    timeoutSeconds: options.timeoutSeconds ?? 900,
    intervalSeconds: options.intervalSeconds ?? 10,
    outputFile: options.outputFile,
  });

  writeOutputs({
    repository: result.repository,
    run_id: result.runId,
    app_sha: result.manifest.appSha,
    gateway_image: result.manifest.gatewayImage,
    migrations_image: result.manifest.migrationsImage,
    openpath_api_image: result.manifest.openpathApiImage,
    spa_image: result.manifest.spaImage,
    verifier_image: result.manifest.verifierImage,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
