import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeReleaseCandidateTimings } from '../scripts/measure-release-candidate-timings.mjs';

test('summarizeReleaseCandidateTimings identifies the repeated release-candidate gate', () => {
  const summary = summarizeReleaseCandidateTimings([
    {
      sha: 'first-sha',
      families: {
        gateway: { buildRequired: false, familyDurationSeconds: 1 },
        migrations: { buildRequired: false, familyDurationSeconds: 1 },
        openpathApi: { buildRequired: false, familyDurationSeconds: 1 },
        spa: { buildRequired: false, familyDurationSeconds: 2 },
        verifier: {
          buildRequired: true,
          amd64DurationSeconds: 85,
          arm64DurationSeconds: 329,
          publishDurationSeconds: 19,
          familyDurationSeconds: 348,
        },
      },
    },
    {
      sha: 'second-sha',
      families: {
        gateway: { buildRequired: false, familyDurationSeconds: 1 },
        migrations: { buildRequired: false, familyDurationSeconds: 1 },
        openpathApi: { buildRequired: false, familyDurationSeconds: 1 },
        spa: { buildRequired: false, familyDurationSeconds: 2 },
        verifier: {
          buildRequired: true,
          amd64DurationSeconds: 88,
          arm64DurationSeconds: 310,
          publishDurationSeconds: 17,
          familyDurationSeconds: 327,
        },
      },
    },
  ]);

  assert.deepEqual(summary.samples, [
    {
      sha: 'first-sha',
      gateFamily: 'verifier',
      gatePlatform: 'arm64',
      familyDurationSeconds: 348,
      platformDurationSeconds: 329,
      buildRequired: true,
    },
    {
      sha: 'second-sha',
      gateFamily: 'verifier',
      gatePlatform: 'arm64',
      familyDurationSeconds: 327,
      platformDurationSeconds: 310,
      buildRequired: true,
    },
  ]);
  assert.deepEqual(summary.gateCandidate, {
    family: 'verifier',
    platform: 'arm64',
    samples: 2,
    maxFamilyDurationSeconds: 348,
    maxPlatformDurationSeconds: 329,
  });
  assert.equal(summary.recommendation.action, 'evaluate-runner-or-cache');
  assert.match(summary.recommendation.reason, /verifier arm64/);
});

test('summarizeReleaseCandidateTimings asks for more samples before optimizing one run', () => {
  const summary = summarizeReleaseCandidateTimings([
    {
      sha: 'single-sha',
      families: {
        verifier: {
          buildRequired: true,
          amd64DurationSeconds: 85,
          arm64DurationSeconds: 329,
          familyDurationSeconds: 348,
        },
      },
    },
  ]);

  assert.equal(summary.gateCandidate?.family, 'verifier');
  assert.equal(summary.gateCandidate?.platform, 'arm64');
  assert.equal(summary.recommendation.action, 'measure-more');
  assert.match(summary.recommendation.reason, /at least two/);
});
