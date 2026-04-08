import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readReleaseJsonFixture } from './helpers/release-fixtures.ts';
import {
  buildReleaseCandidateManifestOutputs,
  formatFirefoxReleaseAssetsTimeoutError,
  formatReleaseCandidateRunFailure,
  resolveWorkflowRunId,
  selectLatestArtifact,
} from '../scripts/wait-for-release-candidate.mjs';

describe('wait-for-release-candidate helpers', () => {
  test('uses databaseId from gh run list payloads when id is absent', () => {
    assert.equal(resolveWorkflowRunId({ databaseId: 123 }), 123);
  });

  test('prefers explicit id when present', () => {
    assert.equal(resolveWorkflowRunId({ id: 456, databaseId: 123 }), 456);
  });

  test('selects the newest non-expired artifact with the requested name', () => {
    const artifact = selectLatestArtifact(
      readReleaseJsonFixture('artifacts.release-candidate.json'),
      { artifactName: 'release-candidate-images-targetsha' }
    );

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

  test('builds the full manifest contract for output files and stdout', () => {
    const outputs = buildReleaseCandidateManifestOutputs({
      repository: 'balejosg/ClassroomPath',
      runId: 24005043099,
      manifest: {
        appSha: '18de339cafab1d1b16e5298eef5567fac710fe02',
        gatewayImage:
          'ghcr.io/balejosg/classroompath-gateway@sha256:4ae4b1dcd58006f3e557be098034c303e7871330af8f8ee9e23ff2a863f6abae',
        migrationsImage:
          'ghcr.io/balejosg/classroompath-migrations@sha256:00623f3c35ff98e33a2efed0a0f51077ee313341add4f74c59999162c1b60f2f',
        openpathApiImage:
          'ghcr.io/balejosg/classroompath-openpath-api@sha256:f5a5f80a2737b42c1a159b9270d45b0c034f2a7040ce0557b7ca06a8ace7ca83',
        linuxAgentVersion: '4.1.11',
        spaImage:
          'ghcr.io/balejosg/classroompath-spa@sha256:4605cd785107285424fedad1421513b6d009763453b04116103bdc5b64df05a6',
        verifierImage:
          'ghcr.io/balejosg/classroompath-release-verifier@sha256:2e685d6907fd5285bd2a9243c95be56769484b77d81d6788aa07673f2cab53db',
      },
    });

    assert.deepEqual(outputs, {
      repository: 'balejosg/ClassroomPath',
      run_id: 24005043099,
      app_sha: '18de339cafab1d1b16e5298eef5567fac710fe02',
      gateway_image:
        'ghcr.io/balejosg/classroompath-gateway@sha256:4ae4b1dcd58006f3e557be098034c303e7871330af8f8ee9e23ff2a863f6abae',
      migrations_image:
        'ghcr.io/balejosg/classroompath-migrations@sha256:00623f3c35ff98e33a2efed0a0f51077ee313341add4f74c59999162c1b60f2f',
      openpath_api_image:
        'ghcr.io/balejosg/classroompath-openpath-api@sha256:f5a5f80a2737b42c1a159b9270d45b0c034f2a7040ce0557b7ca06a8ace7ca83',
      linux_agent_version: '4.1.11',
      spa_image:
        'ghcr.io/balejosg/classroompath-spa@sha256:4605cd785107285424fedad1421513b6d009763453b04116103bdc5b64df05a6',
      verifier_image:
        'ghcr.io/balejosg/classroompath-release-verifier@sha256:2e685d6907fd5285bd2a9243c95be56769484b77d81d6788aa07673f2cab53db',
    });
  });
});
