import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCiSignalPolicyEvidence,
  findFreshDeployEvidenceRun,
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

  test('does not suppress scheduled evidence for a different target environment', () => {
    const runs = [
      {
        databaseId: 5,
        event: 'schedule',
        headSha: 'abc',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-05-01T11:45:00.000Z',
        targetEnvironment: 'staging',
      },
    ];

    const result = resolveDuplicateSuppression({
      eventName: 'schedule',
      runs,
      sha: 'abc',
      currentRunId: 6,
      now: new Date('2026-05-01T12:00:00.000Z'),
      freshnessWindow: '60m',
      targetEnvironment: 'production',
    });

    assert.equal(result.shouldSkip, false);
    assert.match(result.reason, /no fresh scheduled success/);
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

  test('manual dispatch never suppresses scheduled evidence', () => {
    const result = resolveDuplicateSuppression({
      eventName: 'workflow_dispatch',
      runs: [
        {
          databaseId: 5,
          event: 'schedule',
          headSha: 'abc',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-01T11:45:00.000Z',
          targetEnvironment: 'production',
        },
      ],
      sha: 'abc',
      currentRunId: 6,
      now: new Date('2026-05-01T12:00:00.000Z'),
      freshnessWindow: '60m',
      targetEnvironment: 'production',
    });

    assert.equal(result.shouldSkip, false);
    assert.match(result.reason, /workflow_dispatch is not eligible/);
  });

  test('builds explicit skipped duplicate evidence without claiming fresh live proof', () => {
    const result = resolveDuplicateSuppression({
      eventName: 'schedule',
      runs: [
        {
          databaseId: 5,
          event: 'schedule',
          headSha: 'abc',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-01T11:45:00.000Z',
          url: 'https://github.example/runs/5',
          targetEnvironment: 'production',
        },
      ],
      sha: 'abc',
      currentRunId: 6,
      now: new Date('2026-05-01T12:00:00.000Z'),
      freshnessWindow: '60m',
      targetEnvironment: 'production',
    });

    const evidence = buildCiSignalPolicyEvidence({
      eventName: 'schedule',
      sha: 'abc',
      currentRunId: 6,
      targetEnvironment: 'production',
      result,
    });

    assert.equal(evidence.evidenceState, 'skipped-duplicate');
    assert.equal(evidence.evidenceLevel, 'skipped');
    assert.equal(evidence.matching_run_url, 'https://github.example/runs/5');
    assert.equal(evidence.last_live_tested_at, '2026-05-01T11:45:00.000Z');
  });

  test('builds manual dispatch policy evidence without duplicate suppression', () => {
    const result = resolveDuplicateSuppression({
      eventName: 'workflow_dispatch',
      runs: [
        {
          databaseId: 5,
          event: 'schedule',
          headSha: 'abc',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-01T11:45:00.000Z',
          url: 'https://github.example/runs/5',
          targetEnvironment: 'production',
        },
      ],
      sha: 'abc',
      currentRunId: 6,
      now: new Date('2026-05-01T12:00:00.000Z'),
      freshnessWindow: '60m',
      targetEnvironment: 'production',
    });

    const evidence = buildCiSignalPolicyEvidence({
      eventName: 'workflow_dispatch',
      sha: 'abc',
      currentRunId: 6,
      targetEnvironment: 'production',
      result,
    });

    assert.equal(result.shouldSkip, false);
    assert.equal(evidence.evidenceState, 'manual-dispatch-required');
    assert.equal(evidence.evidenceLevel, 'live');
    assert.equal(evidence.matching_run_url, '');
    assert.equal(evidence.last_live_tested_at, '');
  });

  test('suppresses scheduled canary when same-SHA deploy evidence is active', () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    const deployRuns = [
      {
        databaseId: 10,
        workflowName: 'Deploy',
        event: 'push',
        headBranch: 'v1.2.99',
        headSha: 'abc',
        status: 'in_progress',
        conclusion: '',
        updatedAt: '2026-05-01T11:59:00.000Z',
        url: 'https://github.example/deploy/10',
      },
    ];

    assert.equal(
      findFreshDeployEvidenceRun({
        runs: deployRuns,
        sha: 'abc',
        currentRunId: 6,
        now,
        freshnessMs: parseFreshnessWindow('60m'),
      })?.databaseId,
      10
    );

    const result = resolveDuplicateSuppression({
      eventName: 'schedule',
      runs: [],
      deployRuns,
      sha: 'abc',
      currentRunId: 6,
      now,
      freshnessWindow: '60m',
    });

    assert.equal(result.shouldSkip, true);
    assert.equal(result.run?.databaseId, 10);
    assert.match(result.reason, /deploy evidence run 10 is already covering abc/);
  });

  test('does not suppress workflow-run post-deploy evidence', () => {
    const result = resolveDuplicateSuppression({
      eventName: 'workflow_run',
      runs: [],
      deployRuns: [
        {
          databaseId: 10,
          workflowName: 'Deploy',
          event: 'push',
          headBranch: 'v1.2.99',
          headSha: 'abc',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-01T11:59:00.000Z',
        },
      ],
      sha: 'abc',
      currentRunId: 6,
      now: new Date('2026-05-01T12:00:00.000Z'),
      freshnessWindow: '60m',
    });

    assert.equal(result.shouldSkip, false);
    assert.match(result.reason, /workflow_run is not eligible/);
  });
});
