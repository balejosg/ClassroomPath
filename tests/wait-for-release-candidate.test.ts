import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReleaseArtifactScenario,
  buildReleaseFixtureScenario,
  buildReleaseManifestScenario,
} from './helpers/release-fixtures.ts';
import {
  buildReleaseCandidateManifestOutputs,
  formatFirefoxReleaseAssetsTimeoutError,
  formatReleaseCandidateRunFailure,
  formatReleaseCandidateWaitProgress,
  resolveLatestSuccessfulReleaseCandidateManifest,
  resolveWorkflowRunId,
  selectLatestArtifact,
} from '../scripts/wait-for-release-candidate.mjs';
import {
  GITHUB_CLI_MAX_BUFFER_BYTES,
  buildDownloadArtifactZipArgs,
  buildListGitHubArtifactsArgs,
  buildViewGitHubRunJobsArgs,
} from '../scripts/lib/github-actions-artifacts.mjs';

describe('wait-for-release-candidate helpers', () => {
  test('uses databaseId from gh run list payloads when id is absent', () => {
    assert.equal(resolveWorkflowRunId({ databaseId: 123 }), 123);
  });

  test('prefers explicit id when present', () => {
    assert.equal(resolveWorkflowRunId({ id: 456, databaseId: 123 }), 456);
  });

  test('selects the newest non-expired artifact with the requested name', () => {
    const artifact = selectLatestArtifact(buildReleaseArtifactScenario(), {
      artifactName: 'release-candidate-images-targetsha',
    });

    assert.equal(artifact.id, 3);
  });

  test('throws when no matching artifact exists', () => {
    assert.throws(
      () =>
        selectLatestArtifact(
          { artifacts: [] },
          { artifactName: 'release-candidate-images-missing' }
        ),
      /No artifact found with name release-candidate-images-missing/
    );
  });

  test('bounds GitHub artifact listing output before JSON parsing', () => {
    assert.ok(GITHUB_CLI_MAX_BUFFER_BYTES >= 16 * 1024 * 1024);
    assert.deepEqual(
      buildListGitHubArtifactsArgs({
        repo: 'balejosg/ClassroomPath',
        artifactName: 'openpath-firefox-release-assets-sha with space',
      }),
      [
        'api',
        'repos/balejosg/ClassroomPath/actions/artifacts?per_page=100&name=openpath-firefox-release-assets-sha%20with%20space',
        '--jq',
        '{artifacts: [.artifacts[] | {id, name, expired, created_at, updated_at, expires_at, workflow_run: {id: .workflow_run.id}}]}',
      ]
    );
  });

  test('downloads artifact zips through stdout instead of unsupported gh api output flags', () => {
    assert.deepEqual(
      buildDownloadArtifactZipArgs({
        repo: 'balejosg/ClassroomPath',
        artifactId: 123,
      }),
      ['api', 'repos/balejosg/ClassroomPath/actions/artifacts/123/zip']
    );
  });

  test('builds the GitHub CLI command for workflow job inspection', () => {
    assert.deepEqual(buildViewGitHubRunJobsArgs({ repo: 'balejosg/ClassroomPath', runId: 987 }), [
      'run',
      'view',
      '987',
      '--repo',
      'balejosg/ClassroomPath',
      '--json',
      'jobs',
    ]);
  });

  test('formats release candidate failures with normalized run ids and timestamps', () => {
    const message = formatReleaseCandidateRunFailure({
      targetSha: 'abc123',
      run: {
        databaseId: 987,
        status: 'completed',
        conclusion: 'failure',
        updatedAt: '2026-03-27T11:00:00Z',
      },
    });

    assert.match(message, /SHA abc123/);
    assert.match(message, /run_id=987/);
    assert.match(message, /status=completed/);
    assert.match(message, /conclusion=failure/);
    assert.match(message, /updated_at=2026-03-27T11:00:00Z/);
  });

  test('formats Firefox asset timeouts with the last observed run context', () => {
    const message = formatFirefoxReleaseAssetsTimeoutError({
      artifactName: 'openpath-firefox-release-assets-openpathsha',
      latestRun: {
        databaseId: 654,
        status: 'completed',
        conclusion: 'failure',
        updatedAt: '2026-03-27T11:05:00Z',
      },
      lastSuccessfulRunWithoutArtifact: {
        databaseId: 321,
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-03-27T11:04:00Z',
      },
    });

    assert.match(message, /openpath-firefox-release-assets-openpathsha/);
    assert.match(message, /latest_run=\{run_id=654, status=completed, conclusion=failure/);
    assert.match(
      message,
      /last_success_without_artifact=\{run_id=321, status=completed, conclusion=success/
    );
  });

  test('formats release candidate wait progress with SHA, state, run context, and run URL', () => {
    const message = formatReleaseCandidateWaitProgress({
      repository: 'balejosg/ClassroomPath',
      targetSha: 'abc123',
      lastState: 'pending',
      latestRun: {
        databaseId: 987,
        status: 'in_progress',
        updatedAt: '2026-03-27T11:00:00Z',
      },
    });

    assert.match(message, /sha=abc123/);
    assert.match(message, /last_state=pending/);
    assert.match(message, /run_id=987/);
    assert.match(message, /status=in_progress/);
    assert.match(message, /updated_at=2026-03-27T11:00:00Z/);
    assert.match(message, /https:\/\/github\.com\/balejosg\/ClassroomPath\/actions\/runs\/987/);
  });

  test('formats release candidate wait progress with the active OpenPath blocker summary', () => {
    const message = formatReleaseCandidateWaitProgress({
      repository: 'balejosg/ClassroomPath',
      targetSha: 'abc123',
      lastState: 'pending',
      latestRun: {
        databaseId: 987,
        status: 'in_progress',
        updatedAt: '2026-03-27T11:00:00Z',
      },
      latestRunJobs: [
        {
          databaseId: 654,
          name: 'derive-release-image-refs',
          status: 'in_progress',
          createdAt: '2026-03-27T10:58:00Z',
          startedAt: '2026-03-27T11:00:30Z',
          steps: [
            {
              name: 'Wait for OpenPath prerelease APT publish',
              status: 'in_progress',
              conclusion: null,
            },
          ],
        },
      ],
      upstreamSha: 'openpathsha',
    });

    assert.match(message, /Waiting for release candidate manifest/);
    assert.match(message, /Waiting on OpenPath prerelease APT for openpathsha/);
    assert.match(message, /Queue: 150s/);
  });

  test('builds the full manifest contract for output files and stdout', () => {
    const openpathFirefoxAssetsImage =
      'ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
    const outputs = buildReleaseCandidateManifestOutputs({
      repository: 'balejosg/ClassroomPath',
      runId: 24005043099,
      manifest: {
        appSha: '18de339cafab1d1b16e5298eef5567fac710fe02',
        gatewayImage:
          'ghcr.io/balejosg/classroompath-gateway@sha256:4ae4b1dcd58006f3e557be098034c303e7871330af8f8ee9e23ff2a863f6abae',
        migrationsImage:
          'ghcr.io/balejosg/classroompath-migrations@sha256:00623f3c35ff98e33a2efed0a0f51077ee313341add4f74c59999162c1b60f2f',
        openpathFirefoxAssetsImage,
        openpathApiImage:
          'ghcr.io/balejosg/classroompath-openpath-api@sha256:f5a5f80a2737b42c1a159b9270d45b0c034f2a7040ce0557b7ca06a8ace7ca83',
        openpathVersion: '4.1.11',
        linuxAgentVersion: '4.1.11',
        linuxAgentAptSuite: 'unstable',
        spaImage:
          'ghcr.io/balejosg/classroompath-spa@sha256:4605cd785107285424fedad1421513b6d009763453b04116103bdc5b64df05a6',
        verifierImage:
          'ghcr.io/balejosg/classroompath-release-verifier@sha256:2e685d6907fd5285bd2a9243c95be56769484b77d81d6788aa07673f2cab53db',
      },
    });

    assert.deepEqual(outputs, {
      repository: 'balejosg/ClassroomPath',
      run_id: '24005043099',
      app_sha: '18de339cafab1d1b16e5298eef5567fac710fe02',
      gateway_image:
        'ghcr.io/balejosg/classroompath-gateway@sha256:4ae4b1dcd58006f3e557be098034c303e7871330af8f8ee9e23ff2a863f6abae',
      migrations_image:
        'ghcr.io/balejosg/classroompath-migrations@sha256:00623f3c35ff98e33a2efed0a0f51077ee313341add4f74c59999162c1b60f2f',
      openpath_firefox_assets_image: openpathFirefoxAssetsImage,
      openpath_api_image:
        'ghcr.io/balejosg/classroompath-openpath-api@sha256:f5a5f80a2737b42c1a159b9270d45b0c034f2a7040ce0557b7ca06a8ace7ca83',
      openpath_version: '4.1.11',
      linux_agent_version: '4.1.11',
      linux_agent_apt_suite: 'unstable',
      spa_image:
        'ghcr.io/balejosg/classroompath-spa@sha256:4605cd785107285424fedad1421513b6d009763453b04116103bdc5b64df05a6',
      verifier_image:
        'ghcr.io/balejosg/classroompath-release-verifier@sha256:2e685d6907fd5285bd2a9243c95be56769484b77d81d6788aa07673f2cab53db',
    });
  });

  test('resolves the latest successful release-candidate manifest into the canonical shape', () => {
    const resolved = resolveLatestSuccessfulReleaseCandidateManifest({
      repository: 'balejosg/ClassroomPath',
      manifestContent: buildReleaseManifestScenario().replaceAll('target-sha', 'newer-sha'),
      runs: buildReleaseFixtureScenario('latest-success'),
    });

    assert.deepEqual(resolved, {
      repository: 'balejosg/ClassroomPath',
      headSha: 'newer-sha',
      runId: '402',
      manifest: {
        appSha: 'newer-sha',
        gatewayImage: 'ghcr.io/balejosg/classroompath-gateway@sha256:1',
        migrationsImage: 'ghcr.io/balejosg/classroompath-migrations@sha256:2',
        openpathFirefoxAssetsImage:
          'ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:6',
        openpathApiImage: 'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
        openpathVersion: '4.1.3',
        linuxAgentVersion: '4.1.3',
        linuxAgentAptSuite: 'unstable',
        spaImage: 'ghcr.io/balejosg/classroompath-spa@sha256:4',
        verifierImage: 'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
      },
    });
  });
});
