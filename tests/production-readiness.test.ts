import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildProductionReadinessReport,
  runProductionReadiness,
} from '../scripts/lib/production-readiness.mjs';

const identity = {
  rcRunId: '34124312483',
  candidateSha: 'a'.repeat(40),
  releaseId: 'b'.repeat(64),
  openpathSha: 'c'.repeat(40),
  contractSha256: 'd'.repeat(64),
  recoverySha: 'e'.repeat(40),
};

describe('production readiness contract', () => {
  it('classifies typed blockers without returning secret values', () => {
    const report = buildProductionReadinessReport({
      identity,
      checks: {
        rc: { ok: true, message: 'explicit RC identity is exact' },
        staging: { ok: true, message: 'staging identity is exact' },
        recovery: { ok: false, message: 'token=super-secret recovery authority unavailable' },
        config: { ok: true, message: 'runtime config is valid' },
        host: { ok: false, message: 'host contract blocked' },
        artifacts: { ok: true, message: 'artifacts are exact' },
      },
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.blockers, ['RECOVERY_BLOCKER', 'HOST_BLOCKER']);
    assert.doesNotMatch(JSON.stringify(report), /super-secret/u);
    assert.match(report.checks.recovery.message, /redacted/u);
  });

  it('runs the canonical checks in a stable order and preserves exact identity', async () => {
    const calls: string[] = [];
    const report = await runProductionReadiness({
      identity,
      checks: {
        rc: async () => {
          calls.push('rc');
          return { ok: true, message: 'RC identity is exact' };
        },
        staging: async () => {
          calls.push('staging');
          return { ok: true, message: 'staging identity is exact' };
        },
        recovery: async () => {
          calls.push('recovery');
          return { ok: true, message: 'recovery authority proven' };
        },
        config: async () => {
          calls.push('config');
          return { ok: true, message: 'config is valid' };
        },
        host: async () => {
          calls.push('host');
          return { ok: true, message: 'host contract is valid' };
        },
        artifacts: async () => {
          calls.push('artifacts');
          return { ok: true, message: 'artifacts are exact' };
        },
      },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(calls, ['rc', 'staging', 'recovery', 'config', 'host', 'artifacts']);
    assert.deepEqual(report.identity, identity);
  });
});
