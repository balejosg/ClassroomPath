import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatFirefoxReleaseAssetsTimeoutError,
  formatReleaseCandidateRunFailure,
  resolveWorkflowRunId,
} from '../scripts/wait-for-release-candidate.mjs';

describe('wait-for-release-candidate helpers', () => {
  test('uses databaseId from gh run list payloads when id is absent', () => {
    assert.equal(resolveWorkflowRunId({ databaseId: 123 }), 123);
  });

  test('prefers explicit id when present', () => {
    assert.equal(resolveWorkflowRunId({ id: 456, databaseId: 123 }), 456);
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
});
