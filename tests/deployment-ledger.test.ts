import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const helperPath = resolve(projectRoot, 'scripts/lib/deployment-ledger.sh');

function appendRecord(ledgerPath: string, overrides: Record<string, string> = {}) {
  const environment = {
    DEPLOYMENT_LEDGER_FILE: ledgerPath,
    DEPLOYMENT_ENVIRONMENT: 'production',
    DEPLOYMENT_TRANSACTION_ID: 'tx-167',
    CANDIDATE_SHA: 'a'.repeat(40),
    RELEASE_ID: 'b'.repeat(64),
    PREVIOUS_APP_SHA: 'c'.repeat(40),
    PRODUCTION_RECOVERY_SHA: 'd'.repeat(40),
    DEPLOYMENT_RESULT: 'COMMITTED',
    DEPLOYMENT_HEALTH_STATUS: '200',
    DEPLOYMENT_READY: 'true',
    GITHUB_RUN_ID: '24680',
    DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
    RC_RUN_ID: '34124312483',
    OPENPATH_SHA: 'e'.repeat(40),
    OPENPATH_CONTRACT_SHA256: 'f'.repeat(64),
    DEPLOYMENT_PHASE: 'COMMITTED',
    CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/example/gateway@sha256:' + '1'.repeat(64),
    ...overrides,
  };
  const script = [
    'set -euo pipefail',
    `source "$1"`,
    'deployment_ledger_append_terminal_from_env',
  ].join('\n');
  execFileSync('bash', ['-c', script, 'ledger-test', helperPath], {
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('deployment ledger', () => {
  it('appends terminal facts and does not rewrite an idempotent record', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-'));
    const ledgerPath = join(root, 'release-state', 'deployment-ledger.jsonl');

    appendRecord(ledgerPath);
    const first = readFileSync(ledgerPath, 'utf8');
    appendRecord(ledgerPath);

    assert.equal(readFileSync(ledgerPath, 'utf8'), first);
    const record = JSON.parse(first.trim());
    assert.equal(record.result, 'COMMITTED');
    assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(record.openPathSha, 'e'.repeat(40));
    assert.equal(record.contractSha256, 'f'.repeat(64));
    assert.equal(record.phase, 'COMMITTED');
    assert.equal(record.rollbackAttempted, false);
    assert.equal(record.imageDigests.gateway, `sha256:${'1'.repeat(64)}`);
  });

  it('rejects a transaction id reused for a different candidate identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-conflict-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath);

    assert.throws(
      () => appendRecord(ledgerPath, { CANDIDATE_SHA: 'e'.repeat(40) }),
      /different candidate|identity/u
    );
  });

  it('serializes append operations with a transaction-scoped lock', () => {
    const helper = readFileSync(helperPath, 'utf8');
    assert.match(helper, /mkdir "\$lock_dir"/u);
    assert.match(helper, /deployment-ledger\.jsonl/u);
    assert.match(helper, /LEDGER_APPEND_RESULT/u);
  });
});
