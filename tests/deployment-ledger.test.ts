import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const helperPath = resolve(projectRoot, 'scripts/lib/deployment-ledger.sh');

it('transmits immutable workflow and tag locators to the production ledger', () => {
  const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf8');
  const deployJob = workflow.match(/  deploy-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u)?.[0];

  assert.ok(deployJob, 'production deploy job should be present');
  assert.match(deployJob, /DEPLOYMENT_WORKFLOW_RUN_ID: \$\{\{ github\.run_id \}\}/u);
  assert.match(deployJob, /DEPLOYMENT_TAG: \$\{\{ github\.ref_name \}\}/u);
  assert.match(deployJob, /envs:.*DEPLOYMENT_WORKFLOW_RUN_ID.*DEPLOYMENT_TAG/u);
});

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
    DEPLOYMENT_WORKFLOW_RUN_ID: '24680',
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
    CLASSROOMPATH_MIGRATIONS_IMAGE: 'ghcr.io/example/migrations@sha256:' + '2'.repeat(64),
    OPENPATH_FIREFOX_ASSETS_IMAGE: 'ghcr.io/example/firefox@sha256:' + '3'.repeat(64),
    OPENPATH_API_IMAGE: 'ghcr.io/example/api@sha256:' + '4'.repeat(64),
    CLASSROOMPATH_SPA_IMAGE: 'ghcr.io/example/spa@sha256:' + '5'.repeat(64),
    CLASSROOMPATH_VERIFIER_IMAGE: 'ghcr.io/example/verifier@sha256:' + '6'.repeat(64),
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
    assert.equal(record.schemaVersion, 1);
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

  it('rejects production rollback facts with incomplete or non-distinct identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-rollback-invalid-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    const rolledBack = {
      DEPLOYMENT_TRANSACTION_ID: 'tx-rollback-invalid',
      DEPLOYMENT_RESULT: 'ROLLED_BACK',
      DEPLOYMENT_PHASE: 'ROLLED_BACK',
      MUTATION_BOUNDARY_REACHED: '1',
      ROLLBACK_ATTEMPTED: '1',
      ROLLBACK_RESULT: 'success',
    };

    assert.equal(appendRecordStatus(ledgerPath, { ...rolledBack, RC_RUN_ID: '' }), 1);
    assert.equal(
      appendRecordStatus(ledgerPath, {
        ...rolledBack,
        PREVIOUS_APP_SHA: 'a'.repeat(40),
      }),
      1
    );
    assert.equal(existsSync(ledgerPath), false);
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

  it('rejects a later FAILED fact for an already committed transaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-terminal-conflict-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath);

    assert.equal(
      appendRecordStatus(ledgerPath, {
        DEPLOYMENT_RESULT: 'FAILED',
        DEPLOYMENT_PHASE: 'FAILED',
        DEPLOYMENT_READY: 'false',
        DEPLOYMENT_HEALTH_STATUS: '',
        DEPLOYMENT_CURRENT_SHA: 'a'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '1',
      }),
      1
    );
    assert.equal(readRecords(ledgerPath).length, 1);
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
      () => appendRecord(ledgerPath, { DEPLOYMENT_WORKFLOW_RUN_ID: '99999' }),
      /different identity/u
    );
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  });

  it('rejects non-canonical health numbers and emits parseable zero health', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-health-'));

    assert.throws(
      () => appendRecord(join(root, 'leading-zero.jsonl'), { DEPLOYMENT_HEALTH_STATUS: '001' }),
      /invalid deployment ledger|healthy non-rollback/u
    );

    const zeroLedgerPath = join(root, 'zero.jsonl');
    appendRecord(zeroLedgerPath, {
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: 'FAILED',
      DEPLOYMENT_HEALTH_STATUS: '0',
      DEPLOYMENT_READY: 'false',
    });
    const [record] = readRecords(zeroLedgerPath);
    assert.equal(record.health, 0);

    const curlZeroLedgerPath = join(root, 'curl-zero.jsonl');
    appendRecord(curlZeroLedgerPath, {
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: 'FAILED',
      DEPLOYMENT_HEALTH_STATUS: '000',
      DEPLOYMENT_READY: 'false',
    });
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

  it('rejects a successful terminal fact with an incomplete OCI digest identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-image-incomplete-'));
    assert.equal(
      appendRecordStatus(join(root, 'deployment-ledger.jsonl'), {
        CLASSROOMPATH_VERIFIER_IMAGE: 'ghcr.io/example/verifier:mutable',
      }),
      1
    );
  });

  it('rejects incomplete or internally contradictory committed facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-committed-truth-'));
    const invalidOverrides: Array<Record<string, string>> = [
      { RELEASE_ID: '' },
      { RC_RUN_ID: '' },
      { DEPLOYMENT_WORKFLOW_RUN_ID: '', GITHUB_RUN_ID: '' },
      { DEPLOYMENT_TAG: '', GITHUB_REF_NAME: '' },
      { OPENPATH_SHA: '' },
      { OPENPATH_CONTRACT_SHA256: '' },
      { DEPLOYMENT_HEALTH_STATUS: '503' },
      { DEPLOYMENT_READY: 'false' },
      { ROLLBACK_ATTEMPTED: '1', ROLLBACK_RESULT: 'success' },
    ];
    for (const overrides of invalidOverrides) {
      assert.equal(
        appendRecordStatus(join(root, `${Object.keys(overrides)[0]}.jsonl`), overrides),
        1
      );
    }
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
      'schemaVersion',
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
      /invalid deployment ledger|healthy non-rollback/u
    );
  });

  it('retains only the configured bounded number of newest terminal facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-retention-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');

    for (let index = 1; index <= 5; index += 1) {
      appendRecord(ledgerPath, {
        DEPLOYMENT_LEDGER_MAX_RECORDS: '3',
        DEPLOYMENT_TRANSACTION_ID: `tx-retention-${index}`,
        DEPLOYMENT_WORKFLOW_RUN_ID: String(24680 + index),
      });
    }

    const records = readRecords(ledgerPath);
    assert.equal(records.length, 3);
    assert.deepEqual(
      records.map((record) => record.transactionId),
      ['tx-retention-3', 'tx-retention-4', 'tx-retention-5']
    );
  });

  it('retries retention after a post-append compaction failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-retention-retry-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    const script = [
      'source "$1"',
      'DEPLOYMENT_LEDGER_MAX_RECORDS=1',
      'DEPLOYMENT_TRANSACTION_ID=tx-retention-1',
      'deployment_ledger_append_terminal_from_env',
      'DEPLOYMENT_TRANSACTION_ID=tx-retention-2',
      'DEPLOYMENT_WORKFLOW_RUN_ID=24681',
      'mv() { return 1; }',
      'deployment_ledger_append_terminal_from_env; first=$?',
      'unset -f mv',
      'deployment_ledger_append_terminal_from_env; second=$?',
      'printf "%s %s" "$first" "$second"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script, 'ledger-retention-retry', helperPath], {
      env: { ...process.env, ...buildEnvironment(ledgerPath) },
      encoding: 'utf8',
    });
    assert.equal(result.stdout.trim(), '1 0');
    assert.equal(readRecords(ledgerPath).length, 1);
    assert.equal(readRecords(ledgerPath)[0].transactionId, 'tx-retention-2');
  });

  it('queries the newest immutable fact for an exact transaction id', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-query' });
    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-query',
      DEPLOYMENT_RESULT: 'ROLLED_BACK',
      DEPLOYMENT_PHASE: 'ROLLED_BACK',
      DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
      MUTATION_BOUNDARY_REACHED: '1',
      ROLLBACK_ATTEMPTED: '1',
      ROLLBACK_RESULT: 'success',
    });

    const output = execFileSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-query',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(JSON.parse(output).result, 'ROLLED_BACK');
  });

  it('queries a canonical pre-boundary FAILED fact without OCI digests', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-failed-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-failed-without-digests',
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: 'FAILED',
      DEPLOYMENT_HEALTH_STATUS: '',
      DEPLOYMENT_READY: 'false',
      DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
      MUTATION_BOUNDARY_REACHED: '0',
      CLASSROOMPATH_GATEWAY_IMAGE: '',
      CLASSROOMPATH_MIGRATIONS_IMAGE: '',
      OPENPATH_FIREFOX_ASSETS_IMAGE: '',
      OPENPATH_API_IMAGE: '',
      CLASSROOMPATH_SPA_IMAGE: '',
      CLASSROOMPATH_VERIFIER_IMAGE: '',
    });

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-failed-without-digests',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).result, 'FAILED');
    assert.deepEqual(JSON.parse(result.stdout).imageDigests, {});
  });

  it('queries a canonical FAILED fact with partial OCI digests', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-failed-partial-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-failed-partial-digests',
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: 'FAILED',
      DEPLOYMENT_HEALTH_STATUS: '503',
      DEPLOYMENT_READY: 'false',
      MUTATION_BOUNDARY_REACHED: '1',
      CLASSROOMPATH_MIGRATIONS_IMAGE: '',
      OPENPATH_FIREFOX_ASSETS_IMAGE: '',
      CLASSROOMPATH_SPA_IMAGE: '',
      CLASSROOMPATH_VERIFIER_IMAGE: '',
    });

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-failed-partial-digests',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).imageDigests, {
      gateway: `sha256:${'1'.repeat(64)}`,
      openpathApi: `sha256:${'4'.repeat(64)}`,
    });
  });

  it('queries canonical FAILED facts independently of inherited OpenPath identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-environment-'));
    const digestModes: Array<{ name: string; images: Record<string, string> }> = [
      {
        name: 'none',
        images: {
          CLASSROOMPATH_GATEWAY_IMAGE: '',
          CLASSROOMPATH_MIGRATIONS_IMAGE: '',
          OPENPATH_FIREFOX_ASSETS_IMAGE: '',
          OPENPATH_API_IMAGE: '',
          CLASSROOMPATH_SPA_IMAGE: '',
          CLASSROOMPATH_VERIFIER_IMAGE: '',
        },
      },
      {
        name: 'partial',
        images: {
          CLASSROOMPATH_MIGRATIONS_IMAGE: '',
          OPENPATH_FIREFOX_ASSETS_IMAGE: '',
          CLASSROOMPATH_SPA_IMAGE: '',
          CLASSROOMPATH_VERIFIER_IMAGE: '',
        },
      },
      { name: 'complete', images: {} },
    ];
    const queryEnvironments = [
      { name: 'clean', values: {} },
      { name: 'openpath-sha', values: { OPENPATH_SHA: '7'.repeat(40) } },
      {
        name: 'contract-sha',
        values: { OPENPATH_CONTRACT_SHA256: '8'.repeat(64) },
      },
      {
        name: 'both',
        values: {
          OPENPATH_SHA: '7'.repeat(40),
          OPENPATH_CONTRACT_SHA256: '8'.repeat(64),
        },
      },
    ];

    for (const digestMode of digestModes) {
      const transactionId = `tx-failed-environment-${digestMode.name}`;
      const ledgerPath = join(root, `${digestMode.name}.jsonl`);
      appendRecord(ledgerPath, {
        DEPLOYMENT_TRANSACTION_ID: transactionId,
        DEPLOYMENT_RESULT: 'FAILED',
        DEPLOYMENT_PHASE: 'FAILED',
        DEPLOYMENT_HEALTH_STATUS: '',
        DEPLOYMENT_READY: 'false',
        DEPLOYMENT_CURRENT_SHA: 'c'.repeat(40),
        MUTATION_BOUNDARY_REACHED: '0',
        DEPLOYMENT_LEDGER_OPENPATH_SHA: '',
        OPENPATH_SHA: '',
        DEPLOYMENT_LEDGER_CONTRACT_SHA256: '',
        OPENPATH_CONTRACT_SHA256: '',
        ...digestMode.images,
      });
      const storedRecord = readFileSync(ledgerPath, 'utf8').trim();
      assert.equal(JSON.parse(storedRecord).openPathSha, '');
      assert.equal(JSON.parse(storedRecord).contractSha256, '');

      for (const queryEnvironment of queryEnvironments) {
        const childEnvironment = { ...process.env };
        delete childEnvironment.OPENPATH_SHA;
        delete childEnvironment.OPENPATH_CONTRACT_SHA256;
        Object.assign(childEnvironment, queryEnvironment.values);
        const result = spawnSync(
          'bash',
          [
            '-c',
            'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
            'ledger-query',
            helperPath,
            ledgerPath,
            transactionId,
          ],
          { encoding: 'utf8', env: childEnvironment }
        );
        assert.equal(
          result.status,
          0,
          `${digestMode.name}/${queryEnvironment.name}: ${result.stderr}`
        );
        assert.equal(result.stdout.trim(), storedRecord);
      }
    }
  });

  it('does not modify ledger state or inherited caller variables while querying', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-caller-environment-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, {
      DEPLOYMENT_TRANSACTION_ID: 'tx-caller-environment',
      DEPLOYMENT_RESULT: 'FAILED',
      DEPLOYMENT_PHASE: '',
      DEPLOYMENT_HEALTH_STATUS: '503',
      DEPLOYMENT_READY: 'false',
      MUTATION_BOUNDARY_REACHED: '1',
      DEPLOYMENT_LEDGER_OPENPATH_SHA: '',
      OPENPATH_SHA: '',
      DEPLOYMENT_LEDGER_CONTRACT_SHA256: '',
      OPENPATH_CONTRACT_SHA256: '',
    });
    const before = readFileSync(ledgerPath, 'utf8');
    const queryOutputPath = join(root, 'query-output.json');
    const callerEnvironment = {
      DEPLOYMENT_LEDGER_TIMESTAMP: 'poisoned-ledger-timestamp',
      DEPLOYMENT_LEDGER_OPENPATH_SHA: '9'.repeat(40),
      DEPLOYMENT_LEDGER_CONTRACT_SHA256: 'a'.repeat(64),
      DEPLOYMENT_LEDGER_PHASE: 'ROLLED_BACK',
      DEPLOYMENT_LEDGER_ROLLBACK_ATTEMPTED: 'true',
      DEPLOYMENT_LEDGER_ROLLBACK_RESULT: 'failed',
      OPENPATH_SHA: '7'.repeat(40),
      OPENPATH_CONTRACT_SHA256: '8'.repeat(64),
      DEPLOYMENT_PHASE_UPDATED_AT: 'poisoned-timestamp',
      DEPLOYMENT_PHASE: 'COMMITTED',
      ROLLBACK_ATTEMPTED: 'true',
      ROLLBACK_RESULT: 'success',
      MUTATION_BOUNDARY_REACHED: 'poisoned-boundary',
      CLASSROOMPATH_GATEWAY_IMAGE: 'poisoned-gateway',
      CLASSROOMPATH_MIGRATIONS_IMAGE: 'poisoned-migrations',
      OPENPATH_FIREFOX_ASSETS_IMAGE: 'poisoned-firefox',
      OPENPATH_API_IMAGE: 'poisoned-api',
      CLASSROOMPATH_SPA_IMAGE: 'poisoned-spa',
      CLASSROOMPATH_VERIFIER_IMAGE: 'poisoned-verifier',
    };
    const script = [
      'set -euo pipefail',
      'source "$1"',
      'variables=(',
      '  DEPLOYMENT_LEDGER_TIMESTAMP DEPLOYMENT_LEDGER_OPENPATH_SHA',
      '  DEPLOYMENT_LEDGER_CONTRACT_SHA256 DEPLOYMENT_LEDGER_PHASE',
      '  DEPLOYMENT_LEDGER_ROLLBACK_ATTEMPTED DEPLOYMENT_LEDGER_ROLLBACK_RESULT',
      '  DEPLOYMENT_PHASE_UPDATED_AT OPENPATH_SHA OPENPATH_CONTRACT_SHA256',
      '  DEPLOYMENT_PHASE ROLLBACK_ATTEMPTED ROLLBACK_RESULT MUTATION_BOUNDARY_REACHED',
      '  CLASSROOMPATH_GATEWAY_IMAGE CLASSROOMPATH_MIGRATIONS_IMAGE',
      '  OPENPATH_FIREFOX_ASSETS_IMAGE OPENPATH_API_IMAGE',
      '  CLASSROOMPATH_SPA_IMAGE CLASSROOMPATH_VERIFIER_IMAGE',
      ')',
      'caller_before="$(declare -p "${variables[@]}")"',
      'deployment_ledger_query_transaction "$2" "$3" > "$4"',
      'caller_after="$(declare -p "${variables[@]}")"',
      '[ "$caller_after" = "$caller_before" ]',
      'cat "$4"',
    ].join('\n');
    const result = spawnSync(
      'bash',
      [
        '-c',
        script,
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-caller-environment',
        queryOutputPath,
      ],
      { encoding: 'utf8', env: { ...process.env, ...callerEnvironment } }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, before);
    assert.equal(readFileSync(ledgerPath, 'utf8'), before);
  });

  it('continues to query a canonical COMMITTED fact', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-committed-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-query-committed' });

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-query-committed',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).result, 'COMMITTED');
  });

  it('rejects syntactically invalid JSON even when the key patterns remain present', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-malformed-json-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-malformed-json' });
    const malformed = readFileSync(ledgerPath, 'utf8').replace('"health":200', '"health":NOT_JSON');
    writeFileSync(ledgerPath, malformed, 'utf8');

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-malformed-json',
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('rejects syntactically valid records with types or values incompatible with the result', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-invalid-contract-'));
    const canonicalPath = join(root, 'canonical.jsonl');
    appendRecord(canonicalPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-invalid-contract' });
    const canonical = readFileSync(canonicalPath, 'utf8');
    const corruptions = [
      canonical.replace('"health":200', '"health":"200"'),
      canonical.replace('"health":200', '"health":201'),
      canonical.replace('"ready":true', '"ready":"true"'),
      canonical.replace('"rollbackAttempted":false', '"rollbackAttempted":true'),
      canonical.replace('"result":"COMMITTED"', '"result":"ROLLED_BACK"'),
      canonical.replace('"result":"COMMITTED"', '"result":"FAILED"'),
    ];

    for (const [index, corrupted] of corruptions.entries()) {
      const ledgerPath = join(root, `corrupted-${index}.jsonl`);
      writeFileSync(ledgerPath, corrupted, 'utf8');
      const result = spawnSync(
        'bash',
        [
          '-c',
          'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
          'ledger-query',
          helperPath,
          ledgerPath,
          'tx-invalid-contract',
        ],
        { encoding: 'utf8' }
      );
      assert.notEqual(result.status, 0, `corruption ${index} was accepted`);
      assert.equal(result.stdout, '');
    }
  });

  it('rejects duplicate keys and content outside the canonical allowlist', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-noncanonical-'));
    const canonicalPath = join(root, 'canonical.jsonl');
    appendRecord(canonicalPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-noncanonical' });
    const canonical = readFileSync(canonicalPath, 'utf8');
    const corruptions = [
      canonical.replace('"health":200', '"health":200,"health":200'),
      canonical.replace('"imageDigests":{', '"unexpected":"content","imageDigests":{'),
      canonical.replace(`sha256:${'1'.repeat(64)}`, 'sha256:not-a-digest'),
    ];

    for (const [index, corrupted] of corruptions.entries()) {
      const ledgerPath = join(root, `corrupted-${index}.jsonl`);
      writeFileSync(ledgerPath, corrupted, 'utf8');
      const result = spawnSync(
        'bash',
        [
          '-c',
          'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
          'ledger-query',
          helperPath,
          ledgerPath,
          'tx-noncanonical',
        ],
        { encoding: 'utf8' }
      );
      assert.notEqual(result.status, 0, `noncanonical record ${index} was accepted`);
      assert.equal(result.stdout, '');
    }
  });

  it('rejects malformed or unsupported records during query', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-query-invalid-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    writeFileSync(
      ledgerPath,
      '{"schemaVersion":999,"transactionId":"tx-query","result":"BOGUS"}\n',
      'utf8'
    );
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-query',
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);

    writeFileSync(
      ledgerPath,
      '{"schemaVersion":1,"transactionId":"tx-query","result":"COMMITTED"\n',
      'utf8'
    );
    const truncated = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-query',
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(truncated.status, 0);

    appendRecord(ledgerPath, { DEPLOYMENT_TRANSACTION_ID: 'tx-valid-shape' });
    const validRecord = readFileSync(ledgerPath, 'utf8').trim().split('\n').at(-1) ?? '';
    writeFileSync(ledgerPath, `${validRecord.slice(0, -1)}\n`, 'utf8');
    const missingRootBrace = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; deployment_ledger_query_transaction "$2" "$3"',
        'ledger-query',
        helperPath,
        ledgerPath,
        'tx-valid-shape',
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(missingRootBrace.status, 0);
  });

  it('creates a private ledger and rejects a symbolic-link destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-storage-'));
    const ledgerPath = join(root, 'deployment-ledger.jsonl');
    appendRecord(ledgerPath);
    assert.equal((statSync(ledgerPath).mode & 0o777).toString(8), '600');

    const target = join(root, 'target.jsonl');
    const link = join(root, 'link.jsonl');
    writeFileSync(target, '', 'utf8');
    symlinkSync(target, link);
    assert.equal(appendRecordStatus(link), 1);
    assert.equal(readFileSync(target, 'utf8'), '');
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

  it('retries a failed parent-directory flush before accepting an idempotent record', () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-ledger-directory-sync-retry-'));
    const ledgerPath = join(root, 'directory-sync-retry.jsonl');
    const script = [
      'source "$1"',
      'directory_sync_calls=0',
      'sync() {',
      '  if [ -d "${2:-}" ]; then',
      '    directory_sync_calls=$((directory_sync_calls + 1))',
      '    [ "$directory_sync_calls" -ge 2 ]',
      '    return',
      '  fi',
      '  return 0',
      '}',
      'set +e',
      'deployment_ledger_append_terminal_from_env; first=$?',
      'deployment_ledger_append_terminal_from_env; second=$?',
      'printf "%s %s" "$first" "$second"',
    ].join('\n');

    const statuses = execFileSync(
      'bash',
      ['-c', script, 'ledger-directory-sync-retry', helperPath],
      {
        env: { ...process.env, ...buildEnvironment(ledgerPath) },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
      .toString()
      .trim();

    assert.equal(statuses, '1 0');
    assert.equal(readRecords(ledgerPath).length, 1);
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
        CLASSROOMPATH_GATEWAY_IMAGE: 'gateway@sha256:' + '1'.repeat(64),
        CLASSROOMPATH_MIGRATIONS_IMAGE: 'migrations@sha256:' + '2'.repeat(64),
        OPENPATH_FIREFOX_ASSETS_IMAGE: 'firefox@sha256:' + '3'.repeat(64),
        OPENPATH_API_IMAGE: 'api@sha256:' + '4'.repeat(64),
        CLASSROOMPATH_SPA_IMAGE: 'spa@sha256:' + '5'.repeat(64),
        CLASSROOMPATH_VERIFIER_IMAGE: 'verifier@sha256:' + '6'.repeat(64),
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
