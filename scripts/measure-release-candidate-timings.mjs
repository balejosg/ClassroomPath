#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

function readTimingFiles(paths) {
  return paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.error('Usage: node scripts/measure-release-candidate-timings.mjs <timings.json...>');
    return argv.length === 0 ? 1 : 0;
  }

  process.stdout.write(
    `${JSON.stringify(summarizeReleaseCandidateTimings(readTimingFiles(argv)), null, 2)}\n`
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
