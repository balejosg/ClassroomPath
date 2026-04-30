import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import {
  normalizeWorkflowRunHeadSha,
  normalizeWorkflowRunId,
  normalizeWorkflowRunUpdatedAt,
  resolveArtifactRunId,
  sortArtifactsNewestFirst,
  sortWorkflowRunsNewestFirst,
} from './github-actions.mjs';
import {
  cleanupTemporaryArtifactDir,
  copyArtifactContents,
  downloadArtifactById as downloadArtifactZipById,
  downloadRunArtifact,
  rerunGitHubRunFailedJobs,
  viewGitHubRunJobs,
  viewGitHubRunFailedLog,
  listGitHubArtifacts,
  listGitHubWorkflowRuns,
  readArtifactTextFile,
  tryDownloadRunArtifact,
  waitForArtifactResolution,
} from './github-actions-artifacts.mjs';
import {
  detectRepositorySlug,
  parseReleaseCandidateManifest,
  selectLatestSuccessfulWorkflowRun,
  selectLatestReleaseCandidateRun,
} from './release-images.mjs';
import { buildCanonicalReleaseManifest, serializeReleaseManifest } from './release-manifest.mjs';
import { OPENPATH_PRERELEASE_APT_REQUIRED_CHECK } from './openpath-ci-checks.mjs';
import { formatOpenPathPrereleaseRecoveryDecision } from './openpath-prerelease-recovery.mjs';
import { classifyReleaseWaitBlocker, formatReleaseWaitBlocker } from './release-wait-summary.mjs';

export function buildReleaseCandidateManifestOutputs({ repository, runId, manifest }) {
  return buildCanonicalReleaseManifest({ repository, runId: String(runId), manifest });
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

export function formatWorkflowRunUrl({ repository, run }) {
  const repo = String(repository ?? '').trim();
  const runId = normalizeWorkflowRunId(run);

  if (!repo || !runId) {
    return null;
  }

  return `https://github.com/${repo}/actions/runs/${runId}`;
}

function findFailedStep(jobs = []) {
  for (const job of jobs ?? []) {
    for (const step of job?.steps ?? []) {
      if (step?.conclusion === 'failure') {
        return {
          jobName: String(job.name ?? '').trim(),
          stepName: String(step.name ?? '').trim(),
        };
      }
    }
  }

  const failedJob = (jobs ?? []).find((job) => job?.conclusion === 'failure');
  if (!failedJob) {
    return null;
  }

  return {
    jobName: String(failedJob.name ?? '').trim(),
    stepName: '',
  };
}

function parseAmoThrottleDelaySeconds(output = '') {
  const match = /Expected available in\s+(\d+)\s+seconds?/i.exec(String(output));
  return match ? Number.parseInt(match[1], 10) : null;
}

function summarizeReleaseCandidateFailure({
  repository,
  run,
  latestRunJobs = [],
  failureLog = '',
}) {
  const details = [];
  const failedStep = findFailedStep(latestRunJobs);
  const throttleDelaySeconds = parseAmoThrottleDelaySeconds(failureLog);
  const runId = normalizeWorkflowRunId(run);

  if (failedStep?.jobName) {
    details.push(`job=${failedStep.jobName}`);
  }

  if (failedStep?.stepName) {
    details.push(`step=${failedStep.stepName}`);
  }

  if (throttleDelaySeconds !== null) {
    details.push(`amo_throttle_delay_seconds=${throttleDelaySeconds}`);
  }

  if (repository && runId) {
    details.push(`rerun_command="gh run rerun ${runId} --repo ${repository} --failed"`);
  }

  return details.length > 0 ? `; ${details.join('; ')}` : '';
}

export function formatReleaseCandidateRunFailure({
  targetSha,
  run,
  repository = '',
  latestRunJobs = [],
  failureLog = '',
}) {
  return `Release candidate workflow run for SHA ${targetSha} failed (${formatWorkflowRunContext(
    run
  )}${summarizeReleaseCandidateFailure({ repository, run, latestRunJobs, failureLog })})`;
}

export function formatReleaseCandidateWaitProgress({
  repository,
  targetSha,
  lastState = 'missing',
  latestRun = null,
  latestRunJobs = [],
  openPathRecoveryDecision = null,
  upstreamSha = '',
}) {
  const details = [
    `sha=${targetSha}`,
    `last_state=${lastState}`,
    `latest_run=${formatWorkflowRunContext(latestRun)}`,
  ];
  const runUrl = formatWorkflowRunUrl({ repository, run: latestRun });

  if (runUrl) {
    details.push(`run_url=${runUrl}`);
  }

  const blocker = classifyReleaseWaitBlocker({
    currentStep: '',
    workflow: 'release-candidate-images.yml',
    runUrl,
    upstreamSha,
    latestRunStatus: latestRun?.status ?? '',
    latestRunJobs,
  });

  const blockerText = formatReleaseWaitBlocker(blocker);

  let recoveryText = '';
  if (openPathRecoveryDecision?.state === 'waiting') {
    recoveryText = 'Active blocker: OpenPath prerelease APT pending.';
  } else if (openPathRecoveryDecision?.state === 'rerun_available') {
    recoveryText = 'Active blocker: OpenPath prerelease APT failed and rerun is available.';
  } else if (openPathRecoveryDecision?.state === 'failed') {
    recoveryText = 'Active blocker: ClassroomPath RC failed after upstream was green.';
  }

  return [
    `Waiting for release candidate manifest (${details.join('; ')})`,
    blockerText,
    recoveryText,
  ]
    .filter(Boolean)
    .join('\n');
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

export function shouldRerunReleaseCandidateAfterOpenPathAptFailure({
  alreadyReran = false,
  recoveryDecision = null,
} = {}) {
  if (!alreadyReran && recoveryDecision?.state === 'rerun_available') {
    return {
      shouldRerun: true,
      reason:
        'OpenPath prerelease APT wait failed, but the OpenPath recovery path is rerun-available',
    };
  }

  return {
    shouldRerun: false,
    reason: alreadyReran
      ? 'Release-candidate workflow has already been rerun once'
      : `OpenPath prerelease recovery state is ${recoveryDecision?.state ?? 'unknown'}`,
  };
}

function resolveOpenPathPrereleaseRecoveryAfterAptWait({ upstreamSha, cwd }) {
  const sha = String(upstreamSha ?? '').trim();
  if (!sha) {
    return null;
  }

  try {
    return JSON.parse(
      execFileSync('node', ['scripts/openpath-required-checks.mjs', 'recovery'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENPATH_SHA: sha,
          OPENPATH_REQUIRED_CHECKS: OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
        },
      }).trim() || 'null'
    );
  } catch {
    return null;
  }
}

function buildReleaseCandidateFailureContext({ failureMessage, recoveryDecision, rerunReason }) {
  return [
    failureMessage,
    recoveryDecision ? formatOpenPathPrereleaseRecoveryDecision(recoveryDecision) : '',
    rerunReason,
  ]
    .filter(Boolean)
    .join('\n');
}

function verifyOpenPathRequiredChecksAfterAptWait({ upstreamSha, cwd }) {
  const recoveryDecision = resolveOpenPathPrereleaseRecoveryAfterAptWait({ upstreamSha, cwd });

  if (!recoveryDecision) {
    return false;
  }

  return recoveryDecision.state === 'ready' || recoveryDecision.state === 'rerun_available';
}

function resolveReleaseCandidateOpenPathRecovery({ upstreamSha, cwd }) {
  const recoveryDecision = resolveOpenPathPrereleaseRecoveryAfterAptWait({ upstreamSha, cwd });

  if (recoveryDecision) {
    return recoveryDecision;
  }

  try {
    execFileSync('node', ['scripts/openpath-required-checks.mjs'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENPATH_SHA: sha,
      },
    });
    return { state: 'ready' };
  } catch {
    return { state: 'failed' };
  }
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

function resolveSuccessfulReleaseCandidateRun(run) {
  const runId = normalizeWorkflowRunId(run);
  if (!runId) {
    throw new Error('Latest successful release candidate run is missing runId');
  }

  const headSha = String(normalizeWorkflowRunHeadSha(run) ?? '').trim();
  if (!headSha) {
    throw new Error('Latest successful release candidate run is missing headSha');
  }

  return {
    headSha,
    runId: String(runId),
  };
}

function buildResolvedReleaseCandidateManifest({ repository, run, manifestContent }) {
  const { headSha, runId } = resolveSuccessfulReleaseCandidateRun(run);

  return {
    repository,
    headSha,
    runId,
    manifest: parseReleaseCandidateManifest(manifestContent, { sha: headSha }),
  };
}

function downloadManifest({ repo, runId, sha, cwd }) {
  return {
    ...downloadRunArtifact({
      repo,
      runId,
      artifactName: `release-candidate-images-${sha}`,
      cwd,
      tempPrefix: 'classroompath-release-candidate-',
    }),
    manifestFileName: 'release-candidate-images.env',
  };
}

function downloadArtifactById({ repo, artifactId, cwd }) {
  return {
    ...downloadArtifactZipById({
      repo,
      artifactId,
      cwd,
      tempPrefix: 'classroompath-release-candidate-',
    }),
    manifestFileName: 'release-candidate-images.env',
  };
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
  return tryDownloadRunArtifact({
    repo,
    runId,
    artifactName,
    cwd,
    tempPrefix: 'classroompath-artifact-',
  });
}

export function resolveLatestSuccessfulReleaseCandidateManifest({
  repository,
  runs,
  manifestContent,
  cwd,
} = {}) {
  const repo = detectRepositorySlug({ repository, cwd });
  const run = selectLatestSuccessfulWorkflowRun(runs);

  return buildResolvedReleaseCandidateManifest({
    repository: repo,
    run,
    manifestContent,
  });
}

export function readLatestSuccessfulReleaseCandidateManifest({ repository, runs, cwd } = {}) {
  const repo = detectRepositorySlug({ repository, cwd });
  const workflowRuns =
    runs ??
    listGitHubWorkflowRuns({
      repo,
      workflow: 'release-candidate-images.yml',
      cwd,
    });
  const run = selectLatestSuccessfulWorkflowRun(workflowRuns);
  const { headSha, runId } = resolveSuccessfulReleaseCandidateRun(run);
  const { artifactDir, manifestFileName } = downloadManifest({
    repo,
    runId,
    sha: headSha,
    cwd,
  });

  try {
    return buildResolvedReleaseCandidateManifest({
      repository: repo,
      run,
      manifestContent: readArtifactTextFile({ artifactDir, fileName: manifestFileName }),
    });
  } finally {
    cleanupTemporaryArtifactDir(artifactDir);
  }
}

export function waitForReleaseCandidateManifest({
  sha,
  repository,
  timeoutSeconds = 900,
  intervalSeconds = 10,
  outputFile,
  upstreamSha = '',
  cwd,
} = {}) {
  const targetSha = String(sha ?? '').trim();
  if (!targetSha) {
    throw new Error('Target SHA is required to resolve a release candidate manifest');
  }

  const repo = detectRepositorySlug({ repository, cwd });
  const artifactName = `release-candidate-images-${targetSha}`;
  let alreadyReranAfterOpenPathAptFailure = false;

  return waitForArtifactResolution({
    timeoutSeconds,
    intervalSeconds,
    attempt() {
      const artifactsPayload = listGitHubArtifacts({ repo, artifactName, cwd });

      try {
        const artifact = selectLatestArtifact(artifactsPayload, { artifactName });
        const { artifactDir, manifestFileName, runId } = downloadReleaseCandidateArtifact({
          repo,
          artifact,
          sha: targetSha,
          cwd,
        });

        try {
          const manifest = parseReleaseCandidateManifest(
            readArtifactTextFile({ artifactDir, fileName: manifestFileName }),
            { sha: targetSha }
          );

          if (outputFile) {
            writeFileSync(
              outputFile,
              serializeReleaseManifest(
                buildReleaseCandidateManifestOutputs({
                  repository: repo,
                  runId,
                  manifest,
                })
              ),
              'utf8'
            );
          }

          return {
            status: 'resolved',
            value: { repository: repo, runId, manifest },
          };
        } finally {
          cleanupTemporaryArtifactDir(artifactDir);
        }
      } catch (artifactError) {
        if (
          !(artifactError instanceof Error) ||
          !artifactError.message.includes(`No artifact found with name ${artifactName}`)
        ) {
          throw artifactError;
        }
      }

      const payload = listGitHubWorkflowRuns({
        repo,
        workflow: 'release-candidate-images.yml',
        sha: targetSha,
        cwd,
      });
      const { state, run } = resolveLatestReleaseCandidateState(payload, { sha: targetSha });
      let latestRunJobs = [];

      if (run && normalizeWorkflowRunId(run)) {
        latestRunJobs =
          viewGitHubRunJobs({
            repo,
            runId: normalizeWorkflowRunId(run),
            cwd,
          })?.jobs ?? [];
      }

      if (state === 'failed' && run) {
        const runId = normalizeWorkflowRunId(run);
        const failureLog = runId ? viewGitHubRunFailedLog({ repo, runId, cwd }) : '';
        const failureMessage = formatReleaseCandidateRunFailure({
          targetSha,
          repository: repo,
          run,
          latestRunJobs,
          failureLog,
        });
        const recoveryDecision = resolveReleaseCandidateOpenPathRecovery({
          upstreamSha,
          cwd,
        });
        const rerunDecision = shouldRerunReleaseCandidateAfterOpenPathAptFailure({
          alreadyReran: alreadyReranAfterOpenPathAptFailure,
          recoveryDecision,
        });

        if (rerunDecision.shouldRerun && runId) {
          console.error(
            `${buildReleaseCandidateFailureContext({
              failureMessage,
              recoveryDecision,
              rerunReason: rerunDecision.reason,
            })}; rerunning failed jobs once.`
          );
          rerunGitHubRunFailedJobs({ repo, runId, cwd });
          alreadyReranAfterOpenPathAptFailure = true;
          return {
            status: 'pending',
            context: {
              lastState: 'rerun_requested',
              latestRun: run,
              latestRunJobs,
              openPathRecoveryDecision: recoveryDecision,
            },
          };
        }

        throw new Error(
          buildReleaseCandidateFailureContext({
            failureMessage,
            recoveryDecision,
            rerunReason: rerunDecision.reason,
          })
        );
      }

      return {
        status: 'pending',
        context: { lastState: state, latestRun: run, latestRunJobs },
      };
    },
    onPending({
      lastState = 'missing',
      latestRun = null,
      latestRunJobs = [],
      openPathRecoveryDecision = null,
    } = {}) {
      console.error(
        formatReleaseCandidateWaitProgress({
          repository: repo,
          targetSha,
          lastState,
          latestRun,
          latestRunJobs,
          openPathRecoveryDecision,
          upstreamSha,
        })
      );
    },
    formatTimeoutError({
      lastState = 'missing',
      latestRun = null,
      openPathRecoveryDecision = null,
    }) {
      return [
        `Timed out waiting for a successful release candidate manifest for SHA ${targetSha} (last_state=${lastState}; latest_run=${formatWorkflowRunContext(latestRun)})`,
        openPathRecoveryDecision
          ? formatOpenPathPrereleaseRecoveryDecision(openPathRecoveryDecision)
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  });
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
  return waitForArtifactResolution({
    timeoutSeconds,
    intervalSeconds,
    attempt() {
      const artifactsPayload = listGitHubArtifacts({ repo, artifactName, cwd });
      try {
        const artifact = selectLatestArtifact(artifactsPayload, { artifactName });
        const artifactId = artifact.id ?? artifact.databaseId;
        if (!artifactId) {
          throw new Error(`Firefox release assets artifact ${artifactName} has no artifact id`);
        }

        const { artifactDir } = downloadArtifactZipById({
          repo,
          artifactId,
          cwd,
          tempPrefix: 'classroompath-firefox-assets-',
        });

        try {
          if (outputDir) {
            copyArtifactContents({ artifactDir, outputDir });
          }

          return {
            status: 'resolved',
            value: {
              repository: repo,
              runId: resolveArtifactRunId(artifact) ?? '',
              artifactName,
            },
          };
        } finally {
          cleanupTemporaryArtifactDir(artifactDir);
        }
      } catch (artifactError) {
        if (
          !(artifactError instanceof Error) ||
          !artifactError.message.includes(`No artifact found with name ${artifactName}`)
        ) {
          throw artifactError;
        }
      }

      const payload = listGitHubWorkflowRuns({
        repo,
        workflow: 'firefox-release-assets.yml',
        cwd,
      });

      const latestRun = selectLatestWorkflowRun(payload);
      let lastSuccessfulRunWithoutArtifact = null;

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
            copyArtifactContents({ artifactDir: download.artifactDir, outputDir });
          }

          return {
            status: 'resolved',
            value: {
              repository: repo,
              runId,
              artifactName,
            },
          };
        } finally {
          cleanupTemporaryArtifactDir(download.artifactDir);
        }
      }

      return {
        status: 'pending',
        context: { latestRun, lastSuccessfulRunWithoutArtifact },
      };
    },
    formatTimeoutError({ latestRun = null, lastSuccessfulRunWithoutArtifact = null }) {
      return formatFirefoxReleaseAssetsTimeoutError({
        artifactName,
        latestRun,
        lastSuccessfulRunWithoutArtifact,
      });
    },
  });
}
