#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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

function summarizeFamily(familyName, familyTiming = {}) {
  const amd64DurationSeconds = normalizeSeconds(familyTiming.amd64DurationSeconds);
  const arm64DurationSeconds = normalizeSeconds(familyTiming.arm64DurationSeconds);
  const platform =
    arm64DurationSeconds >= amd64DurationSeconds
      ? { name: 'arm64', durationSeconds: arm64DurationSeconds }
      : { name: 'amd64', durationSeconds: amd64DurationSeconds };

  return {
    buildRequired: Boolean(familyTiming.buildRequired),
    family: familyName,
    familyDurationSeconds: normalizeSeconds(familyTiming.familyDurationSeconds),
    platform: platform.name,
    platformDurationSeconds: platform.durationSeconds,
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
      platformDurationSeconds: 0,
    }
  );

  return {
    sha: String(timing?.sha ?? ''),
    gateFamily: gateFamily.family,
    gatePlatform: gateFamily.platform,
    familyDurationSeconds: gateFamily.familyDurationSeconds,
    platformDurationSeconds: gateFamily.platformDurationSeconds,
    buildRequired: gateFamily.buildRequired,
  };
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
      maxPlatformDurationSeconds: 0,
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
    reason: `${gateCandidate.family} ${gateCandidate.platform} was the repeated release-candidate gate across ${gateCandidate.samples} samples; compare registry cache evidence and runner cost before changing policy.`,
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
      timings.push(
        JSON.parse(
          readTimingArtifactText({
            artifactDir: artifact.artifactDir,
            fileName: 'release-candidate-timings.json',
          })
        )
      );
    } finally {
      cleanupTimingArtifactDir(artifact.artifactDir);
    }

    if (timings.length >= requestedSamples) {
      break;
    }
  }

  return timings;
}

function readTimingFiles(paths) {
  return paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.error(
      [
        'Usage:',
        '  node scripts/measure-release-candidate-timings.mjs <timings.json...>',
        '  node scripts/measure-release-candidate-timings.mjs latest --repo owner/repo [--limit 3] [--workflow release-candidate-images.yml]',
      ].join('\n')
    );
    return argv.length === 0 ? 1 : 0;
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
