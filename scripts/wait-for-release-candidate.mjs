import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  console.error(
    '  node scripts/wait-for-release-candidate.mjs resolve-firefox-assets --openpath-sha <sha> [--repo <owner/repo>] [--timeout-seconds <seconds>] [--interval-seconds <seconds>] [--output-dir <path>]'
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

    if (token === '--openpath-sha') {
      options.openpathSha = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--output-dir') {
      options.outputDir = rest[index + 1];
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

function serializeOutputs(outputMap) {
  return Object.entries(outputMap)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function buildReleaseCandidateManifestOutputs({ repository, runId, manifest }) {
  return {
    repository,
    run_id: runId,
    app_sha: manifest.appSha,
    gateway_image: manifest.gatewayImage,
    migrations_image: manifest.migrationsImage,
    openpath_api_image: manifest.openpathApiImage,
    linux_agent_version: manifest.linuxAgentVersion,
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };
}

export function resolveWorkflowRunId(run) {
  return run?.id ?? run?.databaseId ?? null;
}

function resolveWorkflowRunUpdatedAt(run) {
  return run?.updatedAt ?? run?.updated_at ?? run?.createdAt ?? run?.created_at ?? null;
}

function sortRunsNewestFirst(runs) {
  return [...runs].sort((left, right) => {
    const leftTime = Date.parse(resolveWorkflowRunUpdatedAt(left) ?? '');
    const rightTime = Date.parse(resolveWorkflowRunUpdatedAt(right) ?? '');
    return rightTime - leftTime;
  });
}

function selectLatestWorkflowRun(payload) {
  return (
    sortRunsNewestFirst(payload).find((run) => {
      return Boolean(run && resolveWorkflowRunId(run));
    }) ?? null
  );
}

export function formatWorkflowRunContext(run) {
  if (!run) {
    return 'none';
  }

  const details = [];
  const runId = resolveWorkflowRunId(run);
  const updatedAt = resolveWorkflowRunUpdatedAt(run);

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

function listWorkflowRuns({ repo, workflow, sha }) {
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
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();

  return JSON.parse(output || '[]');
}

function listArtifacts({ repo, artifactName }) {
  const output = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/actions/artifacts?per_page=100&name=${encodeURIComponent(artifactName)}`,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    }
  ).trim();

  return JSON.parse(output || '{"artifacts":[]}');
}

function normalizeArtifacts(payload) {
  return Array.isArray(payload?.artifacts) ? payload.artifacts : [];
}

function resolveArtifactRunId(artifact) {
  return artifact?.workflow_run?.id ?? artifact?.workflowRun?.id ?? null;
}

function resolveArtifactUpdatedAt(artifact) {
  return (
    artifact?.updated_at ??
    artifact?.updatedAt ??
    artifact?.created_at ??
    artifact?.createdAt ??
    null
  );
}

export function selectLatestArtifact(payload, { artifactName } = {}) {
  const targetArtifactName = String(artifactName ?? '').trim();
  if (!targetArtifactName) {
    throw new Error('Artifact name is required');
  }

  const selected = normalizeArtifacts(payload)
    .filter((artifact) => {
      if (!artifact || artifact.expired === true) {
        return false;
      }

      return String(artifact.name ?? '').trim() === targetArtifactName;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(resolveArtifactUpdatedAt(left) ?? '');
      const rightTime = Date.parse(resolveArtifactUpdatedAt(right) ?? '');
      return rightTime - leftTime;
    })[0];

  if (!selected) {
    throw new Error(`No artifact found with name ${targetArtifactName}`);
  }

  return selected;
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

function downloadArtifactById({ repo, artifactId }) {
  const artifactDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-candidate-'));
  const artifactArchivePath = resolve(artifactDir, 'artifact.zip');

  try {
    const artifactZip = execFileSync(
      'gh',
      ['api', `repos/${repo}/actions/artifacts/${artifactId}/zip`],
      {
        cwd: projectRoot,
        encoding: null,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    writeFileSync(artifactArchivePath, artifactZip);
    execFileSync('unzip', ['-oq', artifactArchivePath, '-d', artifactDir], {
      cwd: projectRoot,
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

function downloadReleaseCandidateArtifact({ repo, artifact, sha }) {
  const runId = resolveArtifactRunId(artifact);
  if (runId) {
    return {
      ...downloadManifest({ repo, runId, sha }),
      runId,
    };
  }

  if (!artifact?.id) {
    throw new Error(
      `Release candidate artifact for SHA ${sha} is missing both workflow_run.id and id`
    );
  }

  return {
    ...downloadArtifactById({ repo, artifactId: artifact.id }),
    runId: null,
  };
}

function tryDownloadArtifact({ repo, runId, artifactName }) {
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
        cwd: projectRoot,
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
} = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to resolve a release candidate manifest');
  }

  const repo = detectRepositorySlug({
    repository,
    cwd: projectRoot,
  });
  const artifactName = `release-candidate-images-${targetSha}`;
  const timeoutMs = Math.max(0, Number(timeoutSeconds) * 1000);
  const intervalMs = Math.max(1, Number(intervalSeconds) * 1000);
  const deadline = Date.now() + timeoutMs;
  let lastState = 'missing';
  let latestRun = null;

  while (true) {
    const artifactsPayload = listArtifacts({ repo, artifactName });

    try {
      const artifact = selectLatestArtifact(artifactsPayload, { artifactName });
      const { artifactDir, manifestPath, runId } = downloadReleaseCandidateArtifact({
        repo,
        artifact,
        sha: targetSha,
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

        return {
          repository: repo,
          runId,
          manifest,
        };
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
} = {}) {
  const targetOpenpathSha = String(openpathSha ?? '').trim();
  if (!targetOpenpathSha) {
    throw new Error('OpenPath SHA is required to resolve Firefox release assets');
  }

  const repo = detectRepositorySlug({
    repository,
    cwd: projectRoot,
  });
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
    });

    latestRun = selectLatestWorkflowRun(payload);
    lastSuccessfulRunWithoutArtifact = null;

    for (const run of sortRunsNewestFirst(payload)) {
      if (run.status !== 'completed' || run.conclusion !== 'success') {
        continue;
      }

      const runId = resolveWorkflowRunId(run);
      if (!runId) {
        continue;
      }

      const download = tryDownloadArtifact({
        repo,
        runId,
        artifactName,
      });

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

function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));

  if (command === 'resolve-manifest' && options.sha) {
    const result = waitForReleaseCandidateManifest({
      sha: options.sha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputFile: options.outputFile,
    });

    writeOutputs(
      buildReleaseCandidateManifestOutputs({
        repository: result.repository,
        runId: result.runId,
        manifest: result.manifest,
      })
    );
    return;
  }

  if (command === 'resolve-firefox-assets' && options.openpathSha) {
    const result = waitForFirefoxReleaseAssets({
      openpathSha: options.openpathSha,
      repository: options.repo ?? process.env.GITHUB_REPOSITORY,
      timeoutSeconds: options.timeoutSeconds ?? 900,
      intervalSeconds: options.intervalSeconds ?? 10,
      outputDir: options.outputDir,
    });

    writeOutputs({
      repository: result.repository,
      run_id: result.runId,
      openpath_sha: options.openpathSha,
      artifact_name: result.artifactName,
    });
    return;
  }

  printUsage();
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
