import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const projectRoot = resolve(import.meta.dirname, '..');

describe('shared deployment runtime executor', () => {
  it('reports a ledger evidence failure without falsifying an already committed runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-ledger-failure-'));
    try {
      const result = await execFileAsync(
        'bash',
        [
          '-c',
          `
        source scripts/lib/deployment-transaction.sh
        source scripts/lib/deploy-runtime-executor.sh
        deployment_transaction_init "$1/phase" previous candidate
        RELEASE_ID=candidate
        TARGET_SHA=candidate
        adapter() { :; }
        deploy_runtime_wait_for_health_and_readiness() { :; }
        fixture_root="$1"
        deployment_state_activate_v2_release() { echo "$RELEASE_ID" > "$fixture_root/current"; }
        deployment_ledger_append_terminal_from_env() { return 1; }
        if deploy_runtime_execute adapter adapter adapter adapter; then echo accepted; else echo rejected; fi
        cat "$1/phase"
      `,
          'ledger',
          root,
        ],
        { cwd: projectRoot }
      );
      assert.match(result.stdout, /^rejected$/m);
      assert.match(result.stdout, /^DEPLOYMENT_PHASE=COMMITTED$/m);
      assert.match(result.stdout, /^CURRENT_RELEASE_ID=candidate$/m);
      assert.match(result.stdout, /^FAILURE_POINT=terminal-ledger$/m);
      assert.equal(readFileSync(join(root, 'current'), 'utf8').trim(), 'candidate');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('preserves the HTTP failure status in health evidence', async () => {
    const result = await execFileAsync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/deploy-runtime-executor.sh
      DEPLOY_RUNTIME_READINESS_ATTEMPTS=1
      curl() { printf 503; }
      deploy_runtime_wait_for_health_and_readiness || true
      echo "$DEPLOYMENT_HEALTH_STATUS"
    `,
      ],
      { cwd: projectRoot }
    );
    assert.equal(result.stdout.trim(), '503');
  });
  it('does not hide a failed transaction stage behind a successful context write', async () => {
    const result = await execFileAsync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/release-execution.sh
      DEPLOYMENT_TRANSACTION_FILE=fixture
      DEPLOY_CONTEXT_FILE=fixture
      deployment_transaction_mark_stage() { return 1; }
      write_deploy_context_state() { :; }
      release_execution_write_deploy_context() { :; }
      if release_execution_mark_stage readiness; then echo accepted; else echo rejected; fi
    `,
      ],
      { cwd: projectRoot }
    );
    assert.equal(result.stdout.trim(), 'rejected');
  });
  it('reports the verified previous bundle SHA for v2-only recovery state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-rollback-identity-'));
    try {
      const result = await execFileAsync(
        'bash',
        [
          '-c',
          `
        source scripts/lib/deployment-transaction.sh
        source scripts/lib/deploy-runtime-executor.sh
        deployment_transaction_init "$1/phase" previous candidate
        deployment_transaction_transition SWITCHING SWITCH
        TARGET_SHA=candidate
        PREVIOUS_APP_SHA=""
        ROLLBACK_RELEASE_APP_SHA=previous-verified
        deploy_runtime_adapter_recover() { return 0; }
        deployment_ledger_append_terminal_from_env() { echo "current=$DEPLOYMENT_CURRENT_SHA"; }
        deploy_runtime_executor_fail injected || true
      `,
          'recovery',
          root,
        ],
        { cwd: projectRoot }
      );
      assert.equal(result.stdout.trim(), 'current=previous-verified');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('preserves durable rollback success when secondary history cannot be written', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-rollback-history-'));
    try {
      const result = await execFileAsync(
        'bash',
        [
          '-c',
          `
        source scripts/lib/deployment-transaction.sh
        source scripts/lib/deploy-runtime-executor.sh
        deployment_transaction_init "$1/phase" previous candidate
        deployment_transaction_transition SWITCHING SWITCH
        deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH
        deployment_transaction_append_history() { [ "$DEPLOYMENT_PHASE" != ROLLED_BACK ]; }
        deploy_runtime_adapter_recover() { return 0; }
        deployment_ledger_append_terminal_from_env() { echo "result=$DEPLOYMENT_RESULT"; }
        deploy_runtime_executor_fail injected || true
        echo "rollback=$ROLLBACK_RESULT"
        cat "$1/phase"
      `,
          'recovery',
          root,
        ],
        { cwd: projectRoot }
      );
      assert.match(result.stdout, /result=ROLLED_BACK/);
      assert.match(result.stdout, /rollback=success/);
      assert.match(result.stdout, /DEPLOYMENT_PHASE=ROLLED_BACK/);
      assert.doesNotMatch(result.stdout, /result=FAILED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('rejects a health transport failure even if curl observed HTTP 200', async () => {
    const result = await execFileAsync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/deploy-runtime-executor.sh
      DEPLOY_RUNTIME_READINESS_ATTEMPTS=1
      curl() { case "\${!#}" in */health) printf 200; return 18;; *) printf '{"ready":true}\\n200';; esac; }
      rollback_readiness_json_is_ready() { return 0; }
      if deploy_runtime_wait_for_health_and_readiness; then echo accepted; else echo rejected; fi
    `,
      ],
      { cwd: projectRoot }
    );
    assert.equal(result.stdout.trim(), 'rejected');
  });
  it('rejects readiness when persisting its stage fails', async () => {
    const result = await execFileAsync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/deploy-runtime-executor.sh
      DEPLOY_RUNTIME_READINESS_ATTEMPTS=1
      curl() { case "\${!#}" in */health) printf 200;; *) printf '{"ready":true}\\n200';; esac; }
      rollback_readiness_json_is_ready() { return 0; }
      release_execution_mark_stage() { return 1; }
      if deploy_runtime_wait_for_health_and_readiness; then echo accepted; else echo rejected; fi
    `,
      ],
      { cwd: projectRoot }
    );
    assert.equal(result.stdout.trim(), 'rejected');
  });

  it('does not report rollback success when its durable terminal write fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-rollback-state-'));
    try {
      const result = await execFileAsync(
        'bash',
        [
          '-c',
          `
        source scripts/lib/deployment-transaction.sh
        source scripts/lib/deploy-runtime-executor.sh
        deployment_transaction_init "$1/phase" previous candidate
        deployment_transaction_transition SWITCHING SWITCH
        deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH
        eval "$(declare -f deployment_transaction_write | sed '1s/deployment_transaction_write/original_transaction_write/')"
        deployment_transaction_write() { [ "$DEPLOYMENT_PHASE" != ROLLED_BACK ] || return 1; original_transaction_write "$@"; }
        deploy_runtime_adapter_recover() { return 0; }
        deployment_ledger_append_terminal_from_env() { echo "result=$DEPLOYMENT_RESULT"; }
        deploy_runtime_executor_fail injected || true
        echo "rollback=$ROLLBACK_RESULT"
      `,
          'recovery',
          root,
        ],
        { cwd: projectRoot }
      );
      assert.doesNotMatch(result.stdout, /result=ROLLED_BACK|rollback=success/);
      assert.match(result.stdout, /result=FAILED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  for (const status of [200, 201, 302, 500]) {
    it(`requires HTTP 200 as well as ready=true (HTTP ${status})`, async () => {
      const server = createServer((request, response) => {
        response.writeHead(request.url === '/health' ? 200 : status);
        response.end('{"ready":true}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const result = await execFileAsync(
          'bash',
          [
            '-c',
            `
          source scripts/lib/deploy-runtime-executor.sh
          source scripts/lib/rollback-readiness.sh
          DEPLOY_RUNTIME_READINESS_ATTEMPTS=1
          DEPLOY_RUNTIME_HEALTH_URL="$1/health"
          DEPLOY_RUNTIME_READY_URL="$1/ready"
          if deploy_runtime_wait_for_health_and_readiness; then echo accepted; else echo rejected; fi
        `,
            'probe',
            `http://127.0.0.1:${address.port}`,
          ],
          { cwd: projectRoot }
        );
        assert.equal(result.stdout.trim(), status === 200 ? 'accepted' : 'rejected');
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });
  }

  it('owns mutation boundary, semantic readiness, commit, recovery result, and ledger hooks', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh'),
      'utf8'
    );

    assert.match(helper, /deploy_runtime_execute\(\)/u);
    assert.match(helper, /DEPLOYMENT_PHASE_SWITCHING/u);
    assert.match(helper, /rollback_readiness_json_is_ready/u);
    assert.match(helper, /deployment_state_activate_v2_release/u);
    assert.match(helper, /deployment_ledger_append_terminal_from_env/u);
  });

  it('is invoked by both staging and production adapters', () => {
    const staging = readFileSync(resolve(projectRoot, 'scripts/deploy-staging-remote.sh'), 'utf8');
    const production = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf8'
    );

    assert.match(staging, /deploy_runtime_execute/u);
    assert.match(production, /deploy_runtime_execute/u);
  });
});
