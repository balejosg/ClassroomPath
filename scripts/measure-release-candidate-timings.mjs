#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  cleanupTemporaryArtifactDir,
  listGitHubWorkflowRuns,
  readArtifactTextFile,
  tryDownloadRunArtifact,
} from './lib/github-actions-artifacts.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSeconds(value) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : 0;
}

function normalizeBoolean(value) {
  return value === true || value === 'true';
}

function normalizeBuildMode(value, buildRequired) {
  if (value === 'fresh' || value === 'reused') {
    return value;
  }

  return normalizeBoolean(buildRequired) ? 'fresh' : 'reused';
}

function normalizePlatformTiming(familyTiming, platform) {
  const upperPlatform = platform === 'arm64' ? 'arm64' : 'amd64';
  const platforms = familyTiming?.platforms ?? {};
  const platformTiming = platforms[upperPlatform] ?? {};
  const legacyPrefix = upperPlatform === 'arm64' ? 'arm64' : 'amd64';
  const buildRequired = normalizeBoolean(
    platformTiming.buildRequired ?? familyTiming?.buildRequired
  );
  const executionSeconds = normalizeSeconds(
    platformTiming.executionSeconds ??
      familyTiming?.[`${legacyPrefix}ExecutionSeconds`] ??
      familyTiming?.[`${legacyPrefix}DurationSeconds`]
  );

  return {
    platform: upperPlatform,
    buildRequired,
    buildMode: normalizeBuildMode(
      platformTiming.buildMode ?? familyTiming?.[`${legacyPrefix}BuildMode`],
      buildRequired
    ),
    cacheScope: String(
      platformTiming.cacheScope ?? familyTiming?.[`${legacyPrefix}CacheScope`] ?? ''
    ),
    queueSeconds: normalizeSeconds(
      platformTiming.queueSeconds ?? familyTiming?.[`${legacyPrefix}QueueSeconds`]
    ),
    executionSeconds,
  };
}

function summarizeFamily(familyName, familyTiming = {}) {
  const amd64Timing = normalizePlatformTiming(familyTiming, 'amd64');
  const arm64Timing = normalizePlatformTiming(familyTiming, 'arm64');
  const platform =
    arm64Timing.executionSeconds >= amd64Timing.executionSeconds ? arm64Timing : amd64Timing;

  return {
    buildRequired: normalizeBoolean(familyTiming.buildRequired),
    buildMode: platform.buildMode,
    cacheScope: platform.cacheScope,
    family: familyName,
    familyDurationSeconds: normalizeSeconds(familyTiming.familyDurationSeconds),
    platform: platform.platform,
    platformQueueSeconds: platform.queueSeconds,
    platformExecutionSeconds: platform.executionSeconds,
    platformDurationSeconds: platform.executionSeconds,
  };
}

function summarizeTimingSample(timing) {
  const families = Object.entries(timing?.families ?? {}).map(([familyName, familyTiming]) =>
    summarizeFamily(familyName, familyTiming)
  );
  const gateFamily = families.reduce(
    (currentGate, family) =>
      family.familyDurationSeconds > currentGate.familyDurationSeconds ? family : currentGate,
    {
      buildRequired: false,
      family: '',
      familyDurationSeconds: 0,
      platform: '',
      platformQueueSeconds: 0,
      platformExecutionSeconds: 0,
      platformDurationSeconds: 0,
      cacheScope: '',
      buildMode: '',
    }
  );

  const sample = {
    sha: String(timing?.sha ?? ''),
    gateFamily: gateFamily.family,
    gatePlatform: gateFamily.platform,
    familyDurationSeconds: gateFamily.familyDurationSeconds,
    platformQueueSeconds: gateFamily.platformQueueSeconds,
    platformExecutionSeconds: gateFamily.platformExecutionSeconds,
    platformDurationSeconds: gateFamily.platformDurationSeconds,
    buildRequired: gateFamily.buildRequired,
    buildMode: gateFamily.buildMode,
    cacheScope: gateFamily.cacheScope,
  };

  if (timing?.runId) {
    sample.runId = timing.runId;
  }

  if (timing?.runUrl) {
    sample.runUrl = String(timing.runUrl);
  }

  return sample;
}

function selectGateCandidate(samples) {
  const candidates = new Map();

  for (const sample of samples) {
    if (!sample.gateFamily) {
      continue;
    }

    const key = `${sample.gateFamily}:${sample.gatePlatform}`;
    const current = candidates.get(key) ?? {
      family: sample.gateFamily,
      platform: sample.gatePlatform,
      samples: 0,
      maxFamilyDurationSeconds: 0,
      maxPlatformQueueSeconds: 0,
      maxPlatformExecutionSeconds: 0,
      maxPlatformDurationSeconds: 0,
      cacheScope: sample.cacheScope,
      buildMode: sample.buildMode,
    };

    current.samples += 1;
    current.maxFamilyDurationSeconds = Math.max(
      current.maxFamilyDurationSeconds,
      sample.familyDurationSeconds
    );
    current.maxPlatformDurationSeconds = Math.max(
      current.maxPlatformDurationSeconds,
      sample.platformDurationSeconds
    );
    current.maxPlatformQueueSeconds = Math.max(
      current.maxPlatformQueueSeconds,
      sample.platformQueueSeconds
    );
    current.maxPlatformExecutionSeconds = Math.max(
      current.maxPlatformExecutionSeconds,
      sample.platformExecutionSeconds
    );
    current.cacheScope ||= sample.cacheScope;
    current.buildMode ||= sample.buildMode;
    candidates.set(key, current);
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.samples !== left.samples) {
      return right.samples - left.samples;
    }

    return right.maxFamilyDurationSeconds - left.maxFamilyDurationSeconds;
  })[0];
}

function buildRecommendation(gateCandidate) {
  if (!gateCandidate) {
    return {
      action: 'measure-more',
      reason: 'No release-candidate timing samples contained family duration data.',
    };
  }

  if (gateCandidate.samples < 2) {
    return {
      action: 'measure-more',
      reason: `Observed ${gateCandidate.family} ${gateCandidate.platform} as the gate once; collect at least two matching timing samples before changing cache or runner policy.`,
    };
  }

  return {
    action: 'evaluate-runner-or-cache',
    reason: `${gateCandidate.family} ${gateCandidate.platform} was the repeated release-candidate gate across ${gateCandidate.samples} samples; compare queue ${gateCandidate.maxPlatformQueueSeconds}s, execution ${gateCandidate.maxPlatformExecutionSeconds}s, cache scope ${gateCandidate.cacheScope || 'unknown'}, and runner cost before changing policy.`,
  };
}

export function summarizeReleaseCandidateTimings(timings) {
  const samples = asArray(timings).map(summarizeTimingSample);
  const gateCandidate = selectGateCandidate(samples);

  return {
    samples,
    gateCandidate,
    recommendation: buildRecommendation(gateCandidate),
  };
}

function normalizePositiveInteger(value, fallback) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function parseNamedOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      throw new Error(`Unexpected argument: ${current}`);
    }

    const name = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }

    options[name] = value;
    index += 1;
  }

  return options;
}

function parseLatestOptions(argv) {
  const options = parseNamedOptions(argv);
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY;

  if (!repo) {
    throw new Error('latest mode requires --repo or GITHUB_REPOSITORY');
  }

  return {
    repo,
    workflow: options.workflow ?? 'release-candidate-images.yml',
    limit: normalizePositiveInteger(options.limit, 3),
    cwd: process.cwd(),
  };
}

function buildRunUrl(repo, runId) {
  return `https://github.com/${repo}/actions/runs/${runId}`;
}

export function collectLatestReleaseCandidateTimings({
  repo,
  workflow = 'release-candidate-images.yml',
  limit = 3,
  cwd = process.cwd(),
  listWorkflowRuns = listGitHubWorkflowRuns,
  downloadTimingArtifact = tryDownloadRunArtifact,
  readArtifactTextFile: readTimingArtifactText = readArtifactTextFile,
  cleanupTemporaryArtifactDir: cleanupTimingArtifactDir = cleanupTemporaryArtifactDir,
} = {}) {
  if (!repo) {
    throw new Error('repo is required to collect release-candidate timings');
  }

  const requestedSamples = normalizePositiveInteger(limit, 3);
  const runs = listWorkflowRuns({
    repo,
    workflow,
    cwd,
    limit: Math.max(requestedSamples * 4, requestedSamples),
  });
  const timings = [];

  for (const run of runs) {
    if (
      run?.status !== 'completed' ||
      run?.conclusion !== 'success' ||
      !run?.headSha ||
      !run?.databaseId
    ) {
      continue;
    }

    const artifactName = `release-candidate-timings-${run.headSha}`;
    const artifact = downloadTimingArtifact({
      repo,
      runId: run.databaseId,
      artifactName,
      cwd,
      tempPrefix: 'classroompath-rc-timings-',
    });

    if (!artifact?.found) {
      continue;
    }

    try {
      const timing = JSON.parse(
        readTimingArtifactText({
          artifactDir: artifact.artifactDir,
          fileName: 'release-candidate-timings.json',
        })
      );
      timings.push({
        ...timing,
        runId: run.databaseId,
        runUrl: buildRunUrl(repo, run.databaseId),
      });
    } finally {
      cleanupTimingArtifactDir(artifact.artifactDir);
    }

    if (timings.length >= requestedSamples) {
      break;
    }
  }

  return timings;
}

function parseTimestampSeconds(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function elapsedTimestampSeconds(start, end) {
  const startSeconds = parseTimestampSeconds(start);
  const endSeconds = parseTimestampSeconds(end);
  return endSeconds > startSeconds ? endSeconds - startSeconds : 0;
}

function findWorkflowJob(workflowJobs, displayName, platform) {
  const expectedName = `Build ${displayName} (${platform})`;
  return asArray(workflowJobs).find((job) => job?.name === expectedName);
}

function enrichPlatformTiming({ familyTiming, displayName, platform, workflowJobs }) {
  const buildRequired = normalizeBoolean(familyTiming.buildRequired);
  const prefix = platform === 'arm64' ? 'arm64' : 'amd64';
  const workflowJob = buildRequired ? findWorkflowJob(workflowJobs, displayName, platform) : null;
  const workflowQueueSeconds = elapsedTimestampSeconds(
    workflowJob?.created_at,
    workflowJob?.started_at
  );
  const workflowExecutionSeconds = elapsedTimestampSeconds(
    workflowJob?.started_at,
    workflowJob?.completed_at
  );
  const executionSeconds = buildRequired
    ? normalizeSeconds(
        workflowExecutionSeconds ||
          familyTiming[`${prefix}ExecutionSeconds`] ||
          familyTiming[`${prefix}DurationSeconds`]
      )
    : 0;

  return {
    platform,
    buildRequired,
    buildMode: normalizeBuildMode(familyTiming[`${prefix}BuildMode`], buildRequired),
    cacheScope: String(familyTiming[`${prefix}CacheScope`] ?? ''),
    queueSeconds: buildRequired
      ? normalizeSeconds(workflowQueueSeconds || familyTiming[`${prefix}QueueSeconds`])
      : 0,
    executionSeconds,
  };
}

export function enrichReleaseCandidateTimingEvidence(timing, workflowJobs = []) {
  const families = Object.fromEntries(
    Object.entries(timing?.families ?? {}).map(([familyName, familyTiming]) => {
      const displayName = String(familyTiming?.displayName ?? familyName);
      const amd64 = enrichPlatformTiming({
        familyTiming,
        displayName,
        platform: 'amd64',
        workflowJobs,
      });
      const arm64 = enrichPlatformTiming({
        familyTiming,
        displayName,
        platform: 'arm64',
        workflowJobs,
      });

      return [
        familyName,
        {
          ...familyTiming,
          amd64QueueSeconds: amd64.queueSeconds,
          arm64QueueSeconds: arm64.queueSeconds,
          amd64ExecutionSeconds: amd64.executionSeconds,
          arm64ExecutionSeconds: arm64.executionSeconds,
          amd64BuildMode: amd64.buildMode,
          arm64BuildMode: arm64.buildMode,
          platforms: {
            amd64,
            arm64,
          },
        },
      ];
    })
  );

  return {
    ...timing,
    families,
  };
}

function fetchGitHubRunJobs({ repo, runId, cwd = process.cwd(), gh = 'gh' }) {
  const result = spawnSync(gh, ['api', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`], {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh api failed with status ${result.status}`);
  }

  return asArray(JSON.parse(result.stdout).jobs);
}

function parseEnrichOptions(argv) {
  const [inputPath, ...optionArgs] = argv;
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('enrich mode requires an input timing JSON path');
  }

  const options = parseNamedOptions(optionArgs);
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY;
  const runId = options['run-id'] ?? process.env.GITHUB_RUN_ID;

  if (!repo) {
    throw new Error('enrich mode requires --repo or GITHUB_REPOSITORY');
  }

  if (!runId) {
    throw new Error('enrich mode requires --run-id or GITHUB_RUN_ID');
  }

  return {
    inputPath,
    outputPath: options.output ?? inputPath,
    repo,
    runId,
    cwd: process.cwd(),
  };
}

function readTimingFiles(paths) {
  return paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

function enrichTimingFile(options) {
  const timing = JSON.parse(readFileSync(options.inputPath, 'utf8'));
  const workflowJobs = fetchGitHubRunJobs(options);
  const enriched = enrichReleaseCandidateTimingEvidence(timing, workflowJobs);
  writeFileSync(options.outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
  return enriched;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.error(
      [
        'Usage:',
        '  node scripts/measure-release-candidate-timings.mjs <timings.json...>',
        '  node scripts/measure-release-candidate-timings.mjs enrich <timings.json> --repo owner/repo --run-id 123 [--output timings.json]',
        '  node scripts/measure-release-candidate-timings.mjs latest --repo owner/repo [--limit 3] [--workflow release-candidate-images.yml]',
      ].join('\n')
    );
    return argv.length === 0 ? 1 : 0;
  }

  if (argv[0] === 'enrich') {
    process.stdout.write(
      `${JSON.stringify(enrichTimingFile(parseEnrichOptions(argv.slice(1))), null, 2)}\n`
    );
    return 0;
  }

  const timings =
    argv[0] === 'latest'
      ? collectLatestReleaseCandidateTimings(parseLatestOptions(argv.slice(1)))
      : readTimingFiles(argv);

  process.stdout.write(`${JSON.stringify(summarizeReleaseCandidateTimings(timings), null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
