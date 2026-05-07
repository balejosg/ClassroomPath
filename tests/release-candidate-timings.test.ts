import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectLatestReleaseCandidateTimings,
  enrichReleaseCandidateTimingEvidence,
  summarizeReleaseCandidateTimings,
} from '../scripts/measure-release-candidate-timings.mjs';

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
      platformQueueSeconds: 0,
      platformExecutionSeconds: 329,
      platformDurationSeconds: 329,
      buildRequired: true,
      buildMode: 'fresh',
      cacheScope: '',
    },
    {
      sha: 'second-sha',
      gateFamily: 'verifier',
      gatePlatform: 'arm64',
      familyDurationSeconds: 327,
      platformQueueSeconds: 0,
      platformExecutionSeconds: 310,
      platformDurationSeconds: 310,
      buildRequired: true,
      buildMode: 'fresh',
      cacheScope: '',
    },
  ]);
  assert.deepEqual(summary.gateCandidate, {
    family: 'verifier',
    platform: 'arm64',
    samples: 2,
    maxFamilyDurationSeconds: 348,
    maxPlatformQueueSeconds: 0,
    maxPlatformExecutionSeconds: 329,
    maxPlatformDurationSeconds: 329,
    buildMode: 'fresh',
    cacheScope: '',
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

test('summarizeReleaseCandidateTimings preserves source run metadata on samples', () => {
  const summary = summarizeReleaseCandidateTimings([
    {
      sha: 'metadata-sha',
      runId: 12345,
      runUrl: 'https://github.com/owner/repo/actions/runs/12345',
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

  assert.equal(summary.samples[0]?.runId, 12345);
  assert.equal(summary.samples[0]?.runUrl, 'https://github.com/owner/repo/actions/runs/12345');
});

test('enrichReleaseCandidateTimingEvidence records per-platform queue, execution, cache, and build mode evidence', () => {
  const enriched = enrichReleaseCandidateTimingEvidence(
    {
      sha: 'timing-sha',
      families: {
        verifier: {
          displayName: 'Verifier',
          buildRequired: true,
          amd64CacheScope: 'release-candidate-verifier-amd64',
          arm64CacheScope: 'release-candidate-verifier-arm64',
          amd64DurationSeconds: 85,
          arm64DurationSeconds: 329,
          publishDurationSeconds: 19,
          familyDurationSeconds: 348,
        },
      },
    },
    [
      {
        name: 'Build Verifier (amd64)',
        created_at: '2026-05-07T10:00:00Z',
        started_at: '2026-05-07T10:00:12Z',
        completed_at: '2026-05-07T10:01:37Z',
      },
      {
        name: 'Build Verifier (arm64)',
        created_at: '2026-05-07T10:00:00Z',
        started_at: '2026-05-07T10:02:10Z',
        completed_at: '2026-05-07T10:07:39Z',
      },
    ]
  );

  assert.deepEqual(enriched.families.verifier.platforms, {
    amd64: {
      platform: 'amd64',
      buildRequired: true,
      buildMode: 'fresh',
      cacheScope: 'release-candidate-verifier-amd64',
      queueSeconds: 12,
      executionSeconds: 85,
    },
    arm64: {
      platform: 'arm64',
      buildRequired: true,
      buildMode: 'fresh',
      cacheScope: 'release-candidate-verifier-arm64',
      queueSeconds: 130,
      executionSeconds: 329,
    },
  });
});

test('summarizeReleaseCandidateTimings uses enriched platform execution evidence when present', () => {
  const summary = summarizeReleaseCandidateTimings([
    {
      sha: 'first-sha',
      families: {
        verifier: {
          buildRequired: true,
          familyDurationSeconds: 348,
          platforms: {
            amd64: {
              platform: 'amd64',
              executionSeconds: 85,
              queueSeconds: 4,
              cacheScope: 'release-candidate-verifier-amd64',
              buildMode: 'fresh',
            },
            arm64: {
              platform: 'arm64',
              executionSeconds: 329,
              queueSeconds: 120,
              cacheScope: 'release-candidate-verifier-arm64',
              buildMode: 'fresh',
            },
          },
        },
      },
    },
    {
      sha: 'second-sha',
      families: {
        verifier: {
          buildRequired: true,
          familyDurationSeconds: 327,
          platforms: {
            amd64: {
              platform: 'amd64',
              executionSeconds: 88,
              queueSeconds: 5,
              cacheScope: 'release-candidate-verifier-amd64',
              buildMode: 'fresh',
            },
            arm64: {
              platform: 'arm64',
              executionSeconds: 310,
              queueSeconds: 90,
              cacheScope: 'release-candidate-verifier-arm64',
              buildMode: 'fresh',
            },
          },
        },
      },
    },
  ]);

  assert.equal(summary.samples[0]?.gatePlatform, 'arm64');
  assert.equal(summary.samples[0]?.platformExecutionSeconds, 329);
  assert.equal(summary.samples[0]?.platformQueueSeconds, 120);
  assert.equal(summary.samples[0]?.cacheScope, 'release-candidate-verifier-arm64');
  assert.equal(summary.samples[0]?.buildMode, 'fresh');
  assert.equal(summary.gateCandidate?.maxPlatformQueueSeconds, 120);
  assert.match(summary.recommendation.reason, /cache scope release-candidate-verifier-arm64/);
});

test('collectLatestReleaseCandidateTimings downloads successful timing artifacts in run order', () => {
  const downloadedArtifacts: string[] = [];
  const cleanedArtifactDirs: string[] = [];

  const timings = collectLatestReleaseCandidateTimings({
    repo: 'owner/repo',
    workflow: 'release-candidate-images.yml',
    limit: 2,
    cwd: '/repo',
    listWorkflowRuns() {
      return [
        {
          databaseId: 101,
          headSha: 'first-sha',
          status: 'completed',
          conclusion: 'success',
        },
        {
          databaseId: 102,
          headSha: 'failed-sha',
          status: 'completed',
          conclusion: 'failure',
        },
        {
          databaseId: 103,
          headSha: 'second-sha',
          status: 'completed',
          conclusion: 'success',
        },
      ];
    },
    downloadTimingArtifact({ artifactName }) {
      downloadedArtifacts.push(artifactName);
      return { found: true, artifactDir: `/tmp/${artifactName}` };
    },
    readArtifactTextFile({ artifactDir }) {
      return JSON.stringify({ sha: artifactDir.replace('/tmp/release-candidate-timings-', '') });
    },
    cleanupTemporaryArtifactDir(artifactDir) {
      cleanedArtifactDirs.push(artifactDir);
    },
  });

  assert.deepEqual(timings, [
    {
      sha: 'first-sha',
      runId: 101,
      runUrl: 'https://github.com/owner/repo/actions/runs/101',
    },
    {
      sha: 'second-sha',
      runId: 103,
      runUrl: 'https://github.com/owner/repo/actions/runs/103',
    },
  ]);
  assert.deepEqual(downloadedArtifacts, [
    'release-candidate-timings-first-sha',
    'release-candidate-timings-second-sha',
  ]);
  assert.deepEqual(cleanedArtifactDirs, [
    '/tmp/release-candidate-timings-first-sha',
    '/tmp/release-candidate-timings-second-sha',
  ]);
});

test('collectLatestReleaseCandidateTimings skips successful runs without timing artifacts', () => {
  const timings = collectLatestReleaseCandidateTimings({
    repo: 'owner/repo',
    workflow: 'release-candidate-images.yml',
    limit: 1,
    cwd: '/repo',
    listWorkflowRuns() {
      return [
        {
          databaseId: 101,
          headSha: 'missing-sha',
          status: 'completed',
          conclusion: 'success',
        },
        {
          databaseId: 102,
          headSha: 'available-sha',
          status: 'completed',
          conclusion: 'success',
        },
      ];
    },
    downloadTimingArtifact({ artifactName }) {
      if (artifactName.includes('missing-sha')) {
        return { found: false, artifactDir: null };
      }

      return { found: true, artifactDir: '/tmp/available' };
    },
    readArtifactTextFile() {
      return JSON.stringify({ sha: 'available-sha' });
    },
    cleanupTemporaryArtifactDir() {},
  });

  assert.deepEqual(timings, [
    {
      sha: 'available-sha',
      runId: 102,
      runUrl: 'https://github.com/owner/repo/actions/runs/102',
    },
  ]);
});
