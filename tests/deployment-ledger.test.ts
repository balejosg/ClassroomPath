import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const helperPath = resolve(projectRoot, 'scripts/lib/deployment-ledger.sh');

function buildEnvironment(
  ledgerPath: string,
  overrides: Record<string, string> = {},
  includeProductionRecovery = true
): Record<string, string> {
  const environment: Record<string, string> = {
    DEPLOYMENT_LEDGER_FILE: ledgerPath,
    DEPLOYMENT_ENVIRONMENT: 'production',
    DEPLOYMENT_TRANSACTION_ID: 'tx-167',
    CANDIDATE_SHA: 'a'.repeat(40),
    RELEASE_ID: 'b'.repeat(64),
    PREVIOUS_APP_SHA: 'c'.repeat(40),
    DEPLOYMENT_RESULT: 'COMMITTED',
    DEPLOYMENT_HEALTH_STATUS: '200',
    DEPLOYMENT_READY: 'true',
    GITHUB_RUN_ID: '24680',
    DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
    RC_RUN_ID: '34124312483',
    DEPLOYMENT_TAG: 'v1.2.380',
    MUTATION_BOUNDARY_REACHED: '1',
    ROLLBACK_ATTEMPTED: '0',
    ROLLBACK_RESULT: 'not_attempted',
    OPENPATH_SHA: 'e'.repeat(40),
    OPENPATH_CONTRACT_SHA256: 'f'.repeat(64),
    DEPLOYMENT_PHASE: 'COMMITTED',
    CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/example/gateway@sha256:' + '1'.repeat(64),
  };
  if (includeProductionRecovery) {
    environment.PRODUCTION_RECOVERY_SHA = 'd'.repeat(40);
  }
  return { ...environment, ...overrides };
}

function appendRecord(
  ledgerPath: string,
  overrides: Record<string, string> = {},
  includeProductionRecovery = true
) {
  const environment = buildEnvironment(ledgerPath, overrides, includeProductionRecovery);
  const childEnvironment = { ...process.env, ...environment };
  if (!includeProductionRecovery) {
    delete childEnvironment.PRODUCTION_RECOVERY_SHA;
    delete childEnvironment.RECOVERY_SOURCE_SHA;
  }
  const script = [
    'set -euo pipefail',
    `source "$1"`,
    'deployment_ledger_append_terminal_from_env',
  ].join('\n');
  execFileSync('bash', ['-c', script, 'ledger-test', helperPath], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function appendRecordStatus(ledgerPath: string, overrides: Record<string, string> = {}) {
  const script = [
    'source "$1"',
    'set +e',
    'deployment_ledger_append_terminal_from_env',
    'status=$?',
    'printf "%s" "$status"',
  ].join('\n');
  return Number(
    execFileSync('bash', ['-c', script, 'ledger-test', helperPath], {
      env: { ...process.env, ...buildEnvironment(ledgerPath, overrides) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  );
}

function readRecords(ledgerPath: string) {
  return readFileSync(ledgerPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
    assert.equal(record.environment, 'production');
    assert.equal(record.transactionId, 'tx-167');
    assert.equal(record.candidateSha, 'a'.repeat(40));
    assert.equal(record.releaseId, 'b'.repeat(64));
    assert.equal(record.previous, 'c'.repeat(40));
    assert.equal(record.recoverySha, 'd'.repeat(40));
    assert.equal(record.current, 'a'.repeat(40));
    assert.equal(record.workflowRunId, '24680');
    assert.equal(record.rcRunId, '34124312483');
    assert.equal(record.tag, 'v1.2.380');
    assert.equal(record.openPathSha, 'e'.repeat(40));
    assert.equal(record.contractSha256, 'f'.repeat(64));
    assert.equal(record.phase, 'COMMITTED');
    assert.equal(record.rollbackAttempted, false);
    assert.equal(record.imageDigests.gateway, `sha256:${'1'.repeat(64)}`);
  });

  it('records a true rollback with previous current, candidate, and recovery identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-rollback-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-rollback',
      DEPLOYMENT_RESULT: 'ROLLED_BACK',
      DEPLOYMENT_PHASE: 'ROLLED_BACK',
      DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
      MUTATION_BOUNDARY_REACHED: '1',
      ROLLBACK_ATTEMPTED: '1',
      ROLLBACK_RESULT: 'success',
    });

    const [record] = readRecords(ledgerPath);
    assert.equal(record.result, 'ROLLED_BACK');
    assert.equal(record.candidateSha, 'a'.repeat(40));
    assert.equal(record.previous, 'c'.repeat(40));
    assert.equal(record.current, 'c'.repeat(40));
    assert.equal(record.recoverySha, 'd'.repeat(40));
    assert.equal(record.rollbackAttempted, true);
    assert.equal(record.rollbackResult, 'success');
  });

  it('records a pre-boundary failure on the previous current without claiming rollback', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-pre-boundary-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-pre-boundary',
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: 'FAILED',
      DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
      MUTATION_BOUNDARY_REACHED: '0',
      ROLLBACK_ATTEMPTED: '0',
      ROLLBACK_RESULT: 'not_attempted',
    });

    const [record] = readRecords(ledgerPath);
    assert.equal(record.result, 'FAILED');
    assert.equal(record.candidateSha, 'a'.repeat(40));
    assert.equal(record.previous, 'c'.repeat(40));
    assert.equal(record.current, 'c'.repeat(40));
    assert.equal(record.rollbackAttempted, false);
    assert.equal(record.rollbackResult, 'not_attempted');
  });

  it('records a terminal failed deployment when rollback is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-rollback-unavailable-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(
      ledgerPath,
      {
        DEPLOYMENT_ENVIRONMENT: 'staging',
        DEPLOYMENT_TRANSACTION_ID: 'tx-rollback-unavailable',
        DEPLOYMENT_RESULT: 'FAILED',
        DEPLOYMENT_PHASE: 'FAILED',
        DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '1',
        ROLLBACK_ATTEMPTED: '1',
        ROLLBACK_RESULT: 'unavailable',
      },
      false
    );

    const [record] = readRecords(ledgerPath);
    assert.equal(record.environment, 'staging');
    assert.equal(record.result, 'FAILED');
    assert.equal(record.current, 'a'.repeat(40));
    assert.equal(record.rollbackAttempted, true);
    assert.equal(record.rollbackResult, 'unavailable');
    assert.equal(record.recoverySha, '');
  });

  it('records a staging rollback with previous current without production recovery identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-staging-rollback-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(
      ledgerPath,
      {
        DEPLOYMENT_ENVIRONMENT: 'staging',
        DEPLOYMENT_TRANSACTION_ID: 'tx-staging-rollback',
        DEPLOYMENT_RESULT: 'ROLLED_BACK',
        DEPLOYMENT_PHASE: 'ROLLED_BACK',
        DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '1',
        ROLLBACK_ATTEMPTED: '1',
        ROLLBACK_RESULT: 'success',
      },
      false
    );

    const [record] = readRecords(ledgerPath);
    assert.equal(record.environment, 'staging');
    assert.equal(record.result, 'ROLLED_BACK');
    assert.equal(record.candidateSha, 'a'.repeat(40));
    assert.equal(record.previous, 'c'.repeat(40));
    assert.equal(record.current, 'c'.repeat(40));
    assert.equal(record.recoverySha, '');
  });

  it('requires mutation boundary and exact terminal phase for commit and rollback', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-terminal-phase-'));

    assert.equal(
      appendRecordStatus(join(root, 'committed-boundary.jsonl'), {
        MUTATION_BOUNDARY_REACHED: '0',
      }),
      1
    );
    assert.equal(
      appendRecordStatus(join(root, 'committed-phase.jsonl'), {
        DEPLOYMENT_PHASE: 'VERIFIED',
      }),
      1
    );
    assert.equal(
      appendRecordStatus(join(root, 'rolled-back-boundary.jsonl'), {
        DEPLOYMENT_RESULT: 'ROLLED_BACK',
        DEPLOYMENT_PHASE: 'ROLLED_BACK',
        DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '0',
        ROLLBACK_ATTEMPTED: '1',
        ROLLBACK_RESULT: 'success',
      }),
      1
    );
    assert.equal(
      appendRecordStatus(join(root, 'rolled-back-phase.jsonl'), {
        DEPLOYMENT_RESULT: 'ROLLED_BACK',
        DEPLOYMENT_PHASE: 'FAILED',
        DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '1',
        ROLLBACK_ATTEMPTED: '1',
        ROLLBACK_RESULT: 'success',
      }),
      1
    );
    assert.equal(
      appendRecordStatus(join(root, 'failed-pre-boundary-phase.jsonl'), {
        DEPLOYMENT_RESULT: 'FAILED',
        DEPLOYMENT_PHASE: 'VERIFIED',
        MUTATION_BOUNDARY_REACHED: '0',
        ROLLBACK_ATTEMPTED: '0',
        ROLLBACK_RESULT: 'not_attempted',
      }),
      1
    );
  });

  it('retains the observed nonterminal phase when failure-state persistence is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-post-boundary-failure-'));

    for (const phase of ['SWITCHING', 'ACTIVATED_UNVERIFIED', 'VERIFIED', 'ROLLING_BACK']) {
      const ledgerPath = join(root, `${phase.toLowerCase()}.jsonl`);
      appendRecord(ledgerPath, {
        DEPLOYMENT_TRANSACTION_ID: `tx-failed-${phase.toLowerCase()}`,
        DEPLOYMENT_RESULT: 'FAILED',
        DEPLOYMENT_PHASE: phase,
        DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '1',
        ROLLBACK_ATTEMPTED: '0',
        ROLLBACK_RESULT: 'not_attempted',
      });

      const [record] = readRecords(ledgerPath);
      assert.equal(record.result, 'FAILED');
      assert.equal(record.phase, phase);
      assert.equal(record.current, 'a'.repeat(40));
    }
  });

  it('rejects FAILED facts that contradict an already successful terminal phase', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-failed-terminal-'));
    for (const phase of ['COMMITTED', 'ROLLED_BACK']) {
      assert.equal(
        appendRecordStatus(join(root, `${phase}.jsonl`), {
          DEPLOYMENT_RESULT: 'FAILED',
          DEPLOYMENT_PHASE: phase,
          MUTATION_BOUNDARY_REACHED: '1',
        }),
        1
      );
    }
  });

  it('keeps prior terminal facts append-only when a later rollback fact is recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-history-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(ledgerPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-history' });
    const committed = readRecords(ledgerPath)[0];
    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-history',
      DEPLOYMENT_RESULT: 'ROLLED_BACK',
      DEPLOYMENT_PHASE: 'ROLLED_BACK',
      DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
      MUTATION_BOUNDARY_REACHED: '1',
      ROLLBACK_ATTEMPTED: '1',
      ROLLBACK_RESULT: 'success',
    });

    const records = readRecords(ledgerPath);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], committed);
    assert.equal(records[1].result, 'ROLLED_BACK');
    assert.equal(records[1].current, 'c'.repeat(40));
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

  it('rejects a transaction id reused for a different workflow locator', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-workflow-conflict-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath);

    assert.throws(
      () => appendRecord(ledgerPath, { GITHUB_RUN_ID: '99999' }),
      /different identity/u
    );
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  });

  it('rejects non-canonical health numbers and emits parseable zero health', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-health-'));

    assert.throws(
      () => appendRecord(join(root, 'leading-zero.jsonl'), { DEPLOYMENT_HEALTH_STATUS: '001' }),
      /invalid deployment ledger/u
    );

    const zeroLedgerPath = join(root, 'zero.jsonl');
    appendRecord(zeroLedgerPath, { DEPLOYMENT_HEALTH_STATUS: '0' });
    const [record] = readRecords(zeroLedgerPath);
    assert.equal(record.health, 0);

    const curlZeroLedgerPath = join(root, 'curl-zero.jsonl');
    appendRecord(curlZeroLedgerPath, { DEPLOYMENT_HEALTH_STATUS: '000' });
    const [curlZeroRecord] = readRecords(curlZeroLedgerPath);
    assert.equal(curlZeroRecord.health, 0);
  });

  it('rejects a transaction id reused for different canonical image digests', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-image-conflict-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath);

    assert.throws(
      () =>
        appendRecord(ledgerPath, {
          CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/example/gateway@sha256:' + '2'.repeat(64),
        }),
      /different identity/u
    );
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  });

  it('writes only the bounded allowlisted schema and ignores arbitrary environment payloads', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-allowlist-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    appendRecord(ledgerPath, {
      DEPLOYMENT_LEDGER_SECRET: 'token-should-not-appear',
      DEPLOYMENT_LEDGER_PAYLOAD: '{"privateKey":"should-not-appear"}',
      FAILURE_MESSAGE: 'arbitrary command output should not appear',
      DEPLOYMENT_STAGE: 'payload-stage',
    });

    const raw = readFileSync(ledgerPath, 'utf8');
    const record = JSON.parse(raw.trim());
    assert.deepEqual(Object.keys(record).sort(), [
      'candidateSha',
      'contractSha256',
      'current',
      'environment',
      'health',
      'imageDigests',
      'openPathSha',
      'phase',
      'previous',
      'rcRunId',
      'ready',
      'recoverySha',
      'releaseId',
      'result',
      'rollbackAttempted',
      'rollbackResult',
      'tag',
      'timestamp',
      'transactionId',
      'workflowRunId',
    ]);
    assert.doesNotMatch(raw, /token-should-not-appear|privateKey|arbitrary command output/u);
  });

  it('rejects oversized or unsafe allowlisted values instead of writing an unbounded record', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-bounds-'));

    assert.throws(
      () => appendRecord(join(root, 'tag.jsonl'), { DEPLOYMENT_TAG: 'x'.repeat(129) }),
      /invalid deployment ledger/u
    );
    assert.throws(
      () => appendRecord(join(root, 'phase.jsonl'), { DEPLOYMENT_PHASE: 'FAILED\nsecret-payload' }),
      /deployment requires/u
    );
    assert.throws(
      () => appendRecord(join(root, 'health.jsonl'), { DEPLOYMENT_HEALTH_STATUS: '1000' }),
      /invalid deployment ledger/u
    );
  });

  it('does not append blank or stale records after build or append failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-failures-'));
    const missingLedgerPath = join(root, 'missing.jsonl');

    assert.equal(appendRecordStatus(missingLedgerPath, { DEPLOYMENT_RESULT: 'INVALID' }), 1);
    assert.equal(existsSync(missingLedgerPath), false);
    assert.equal(existsSync(`${missingLedgerPath}.lock`), false);

    const intactLedgerPath = join(root, 'intact.jsonl');
    appendRecord(intactLedgerPath);
    const before = readFileSync(intactLedgerPath, 'utf8');
    assert.equal(appendRecordStatus(intactLedgerPath, { DEPLOYMENT_RESULT: 'INVALID' }), 1);
    assert.equal(readFileSync(intactLedgerPath, 'utf8'), before);
    assert.equal(existsSync(`${intactLedgerPath}.lock`), false);

    const appendFailurePath = join(root, 'append-target');
    mkdirSync(appendFailurePath);
    assert.equal(appendRecordStatus(appendFailurePath), 1);
    assert.equal(existsSync(`${appendFailurePath}.lock`), false);
  });

  it('reports a durable flush failure after an append and releases its lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-sync-failure-'));
    const ledgerPath = join(root, 'sync-failure.jsonl');
    const script = [
      'source "$1"',
      'sync() { return 1; }',
      'set +e',
      'deployment_ledger_append_terminal_from_env',
      'status=$?',
      'printf "%s" "$status"',
    ].join('\n');

    const status = Number(
      execFileSync('bash', ['-c', script, 'ledger-sync-failure', helperPath], {
        env: { ...process.env, ...buildEnvironment(ledgerPath) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .toString()
        .trim()
    );
    assert.equal(status, 1);
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
    assert.equal(readRecords(ledgerPath).length, 1);
  });

  it('retries idempotent records until durable flush succeeds without duplicating the line', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-sync-retry-'));
    const ledgerPath = join(root, 'sync-retry.jsonl');
    const script = [
      'source "$1"',
      'sync_calls=0',
      'sync() { sync_calls=$((sync_calls + 1)); [ "$sync_calls" -ge 3 ]; }',
      'set +e',
      'DEPLOYMENT_LEDGER_TIMESTAMP="2026-09-08T00:00:00Z"',
      'deployment_ledger_append_terminal_from_env; first=$?',
      'DEPLOYMENT_LEDGER_TIMESTAMP="2026-09-08T00:00:01Z"',
      'deployment_ledger_append_terminal_from_env; second=$?',
      'deployment_ledger_append_terminal_from_env; third=$?',
      'printf "%s %s %s" "$first" "$second" "$third"',
    ].join('\n');

    const statuses = execFileSync('bash', ['-c', script, 'ledger-sync-retry', helperPath], {
      env: {
        ...process.env,
        ...buildEnvironment(ledgerPath, {
          DEPLOYMENT_LEDGER_TIMESTAMP: '2026-09-08T00:00:00Z',
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();

    assert.equal(statuses, '1 1 0');
    assert.equal(readRecords(ledgerPath).length, 1);
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  });

  it('fails fast when the ledger parent cannot be created', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-parent-failure-'));
    const parentFile = join(root, 'parent-file');
    writeFileSync(parentFile, 'not a directory', 'utf8');
    const ledgerPath = join(parentFile, 'deployment-ledger.jsonl');
    const script = [
      'source "$1"',
      'set +e',
      'output="$(deployment_ledger_append_terminal_from_env 2>&1)"',
      'status=$?',
      'printf "%s\\n%s" "$status" "$output"',
    ].join('\n');

    const output = execFileSync('bash', ['-c', script, 'ledger-parent-failure', helperPath], {
      env: {
        ...process.env,
        ...buildEnvironment(ledgerPath, {
          DEPLOYMENT_LEDGER_LOCK_TIMEOUT_SECONDS: '1',
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    assert.match(output, /1[\s\S]*deployment ledger directory creation failed/u);
    assert.doesNotMatch(output, /deployment ledger lock timed out/u);
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  });

  it('serializes concurrent append operations without corrupting JSON lines', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-concurrent-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    const script = [
      'set -euo pipefail',
      'source "$1"',
      'for i in $(seq 1 12); do',
      '  (',
      '    DEPLOYMENT_TRANSACTION_ID="tx-concurrent-$i"',
      '    GITHUB_RUN_ID="$((24680 + i))"',
      '    deployment_ledger_append_terminal_from_env',
      '  ) &',
      'done',
      'wait',
    ].join('\n');
    execFileSync('bash', ['-c', script, 'ledger-concurrent', helperPath], {
      env: {
        ...process.env,
        DEPLOYMENT_LEDGER_FILE: ledgerPath,
        DEPLOYMENT_ENVIRONMENT: 'production',
        CANDIDATE_SHA: 'a'.repeat(40),
        RELEASE_ID: 'b'.repeat(64),
        PREVIOUS_APP_SHA: 'c'.repeat(40),
        PRODUCTION_RECOVERY_SHA: 'd'.repeat(40),
        DEPLOYMENT_RESULT: 'COMMITTED',
        DEPLOYMENT_HEALTH_STATUS: '200',
        DEPLOYMENT_READY: 'true',
        DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
        RC_RUN_ID: '34124312483',
        DEPLOYMENT_TAG: 'v1.2.380',
        MUTATION_BOUNDARY_REACHED: '1',
        ROLLBACK_ATTEMPTED: '0',
        ROLLBACK_RESULT: 'not_attempted',
        OPENPATH_SHA: 'e'.repeat(40),
        OPENPATH_CONTRACT_SHA256: 'f'.repeat(64),
        DEPLOYMENT_PHASE: 'COMMITTED',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const records = readRecords(ledgerPath);
    assert.equal(records.length, 12);
    assert.deepEqual(
      records.map((record) => record.transactionId).sort(),
      Array.from({ length: 12 }, (_, index) => `tx-concurrent-${index + 1}`).sort()
    );
  });
});
