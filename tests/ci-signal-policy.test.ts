import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findFreshSameShaSuccess,
  parseFreshnessWindow,
  resolveDuplicateSuppression,
} from '../scripts/ci-signal-policy.mjs';

describe('CI signal policy', () => {
  test('parses explicit freshness windows', () => {
    assert.equal(parseFreshnessWindow('60m'), 3_600_000);
    assert.equal(parseFreshnessWindow('2h'), 7_200_000);
    assert.equal(parseFreshnessWindow('1d'), 86_400_000);
    assert.throws(() => parseFreshnessWindow('60'), /Unsupported freshness window/);
  });

  test('finds only fresh scheduled same-SHA successes', () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    const runs = [
      {
        databaseId: 1,
        event: 'schedule',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'failure',
        updatedAt: '2026-05-01T11:59:00.000Z',
      },
      {
        databaseId: 2,
        event: 'workflow_dispatch',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T11:58:00.000Z',
      },
      {
        databaseId: 3,
        event: 'schedule',
        headSha: 'def',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T11:57:00.000Z',
      },
      {
        databaseId: 4,
        event: 'schedule',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
      {
        databaseId: 5,
        event: 'schedule',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T11:45:00.000Z',
      },
    ];

    assert.equal(
      findFreshSameShaSuccess({
        runs,
        sha: 'abc',
        currentRunId: 6,
        now,
        freshnessMs: parseFreshnessWindow('60m'),
      })?.databaseId,
      5
    );
  });

  test('suppresses only scheduled duplicate advisory evidence', () => {
    const runs = [
      {
        databaseId: 5,
        event: 'schedule',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T11:45:00.000Z',
      },
    ];
    const now = new Date('2026-05-01T12:00:00.000Z');

    assert.deepEqual(
      resolveDuplicateSuppression({
        eventName: 'workflow_run',
        runs,
        sha: 'abc',
        currentRunId: 6,
        now,
        freshnessWindow: '60m',
      }).shouldSkip,
      false
    );
    assert.equal(
      resolveDuplicateSuppression({
        eventName: 'schedule',
        runs,
        sha: 'abc',
        currentRunId: 6,
        now,
        freshnessWindow: '60m',
      }).shouldSkip,
      true
    );
  });
});
