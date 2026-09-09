import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  extractShellFunction,
  readProjectText,
  runProjectCommand,
} from './helpers/ops-contracts.ts';

describe('github-actions remote helper', () => {
  test('publishes the shared shell functions used by deploy and production canary workflows', () => {
    const helper = readProjectText('scripts/lib/github-actions-remote.sh');

    assert.match(extractShellFunction(helper, 'github_actions_remote_require_values'), /\(\) \{/);
    assert.match(
      extractShellFunction(helper, 'github_actions_remote_write_resolved_host_outputs'),
      /\(\) \{/
    );
    assert.match(extractShellFunction(helper, 'github_actions_remote_install_ssh_key'), /\(\) \{/);
    assert.match(
      extractShellFunction(helper, 'github_actions_remote_classify_ssh_error'),
      /\(\) \{/
    );
    assert.match(extractShellFunction(helper, 'github_actions_remote_ssh_once'), /\(\) \{/);
    assert.match(extractShellFunction(helper, 'github_actions_remote_ssh'), /\(\) \{/);
    assert.match(extractShellFunction(helper, 'github_actions_remote_read_env_key'), /\(\) \{/);
    assert.match(extractShellFunction(helper, 'github_actions_remote_read_file'), /\(\) \{/);
    assert.match(extractShellFunction(helper, 'github_actions_remote_file_size'), /\(\) \{/);
    assert.match(extractShellFunction(helper, 'github_actions_remote_sha256_file'), /\(\) \{/);
  });

  test('can emit resolved-host outputs from the shared helper entrypoint', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_resolve_ssh_host() { printf "ip=127.0.0.1\\nport=22\\n"; }',
        'github_actions_remote_write_resolved_host_outputs "example.com" "22" "deploy" "production"',
      ].join('; '),
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /ip=127\.0\.0\.1/);
    assert.match(result.stdout, /user=deploy/);
  });

  test('classifies common SSH failures for actionable canary diagnostics', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_classify_ssh_error "ssh: connect to host 192.0.2.10 port 22: Connection timed out"',
        'printf "\\n"',
        'github_actions_remote_classify_ssh_error "deploy@host: Permission denied (publickey)."',
        'printf "\\n"',
        'github_actions_remote_classify_ssh_error "ssh: Could not resolve hostname staging"',
      ].join('; '),
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.trim().split('\n'), ['ssh-timeout', 'ssh-auth', 'ssh-dns']);
  });

  test('retries SSH attempts before surfacing the classified failure', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_ssh_once() { echo "ssh: connect to host $4 port $2: Connection timed out" >&2; return 255; }',
        'GITHUB_ACTIONS_REMOTE_SSH_ATTEMPTS=2 GITHUB_ACTIONS_REMOTE_SSH_RETRY_DELAY_SECONDS=0 github_actions_remote_ssh /tmp/key 22 deploy 192.0.2.10 true',
      ].join('; '),
    ]);

    assert.equal(result.status, 255);
    assert.match(result.stderr, /SSH attempt 1\/2 failed \(ssh-timeout, exit 255\)/);
    assert.match(result.stderr, /SSH attempt 2\/2 failed \(ssh-timeout, exit 255\)/);
    assert.match(result.stderr, /SSH failed after 2 attempts \(ssh-timeout, exit 255\)/);
    assert.doesNotMatch(result.stderr, /192\.0\.2\.10|deploy@/);
  });

  test('does not retry or misclassify a remote command exit', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_ssh_once() { return 1; }',
        'GITHUB_ACTIONS_REMOTE_SSH_ATTEMPTS=3 GITHUB_ACTIONS_REMOTE_SSH_RETRY_DELAY_SECONDS=0 github_actions_remote_ssh /tmp/key 22 deploy example.invalid true',
        'exit_code=$?',
        'printf "exit=%s\\n" "$exit_code"',
        'exit "$exit_code"',
      ].join('; '),
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'exit=1\n');
    assert.match(result.stderr, /remote-command-exit-1, exit 1/);
    assert.equal(result.stderr.match(/SSH attempt/g)?.length, 1);
    assert.doesNotMatch(result.stderr, /ssh-(?:auth|timeout|dns|refused)/);
  });

  test('does not let stderr text override a remote command exit classification', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_ssh_once() { printf "%s\\n" "Permission denied" >&2; return 42; }',
        'GITHUB_ACTIONS_REMOTE_SSH_ATTEMPTS=3 GITHUB_ACTIONS_REMOTE_SSH_RETRY_DELAY_SECONDS=0 github_actions_remote_ssh /tmp/key 22 deploy example.invalid true',
      ].join('; '),
    ]);

    assert.equal(result.status, 42);
    assert.match(result.stderr, /remote-command-exit-42, exit 42/);
    assert.doesNotMatch(result.stderr, /ssh-auth/);
  });

  test('surfaces only an allowlisted reader marker for a remote reader failure', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_ssh_once() { printf "%s\\n" "SMOKE_RELEASE_STATE_ERROR=pointer-invalid" "private-path.invalid" >&2; return 42; }',
        'github_actions_remote_ssh /tmp/key 22 deploy example.invalid true',
      ].join('; '),
    ]);

    assert.equal(result.status, 42);
    assert.match(result.stderr, /remote-command-exit-42, exit 42/);
    assert.match(result.stderr, /SMOKE_RELEASE_STATE_ERROR=pointer-invalid/);
    assert.doesNotMatch(result.stderr, /private-path|example\.invalid|deploy/);
  });

  test('does not retry deterministic authentication or host-key failures', () => {
    for (const [message, classification] of [
      ['Permission denied (publickey).', 'ssh-auth'],
      ['Host key verification failed.', 'ssh-host-key'],
      ['Unexpected SSH failure.', 'ssh-unknown'],
    ]) {
      const result = runProjectCommand('bash', [
        '-lc',
        [
          'source scripts/lib/github-actions-remote.sh',
          `github_actions_remote_ssh_once() { printf '%s\\n' '${message}' >&2; return 255; }`,
          'GITHUB_ACTIONS_REMOTE_SSH_ATTEMPTS=3 GITHUB_ACTIONS_REMOTE_SSH_RETRY_DELAY_SECONDS=0 github_actions_remote_ssh /tmp/key 22 deploy example.invalid true',
          'exit_code=$?',
          'printf "exit=%s\\n" "$exit_code"',
          'exit "$exit_code"',
        ].join('; '),
      ]);

      assert.equal(result.status, 255);
      assert.equal(result.stdout, 'exit=255\n');
      assert.equal(result.stderr.match(/SSH attempt/g)?.length, 1);
      assert.match(result.stderr, new RegExp(`${classification}, exit 255`));
    }
  });

  test('publishes only stdout from the successful attempt', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'attempts=0',
        'github_actions_remote_ssh_once() { attempts=$((attempts + 1)); if [ "$attempts" -eq 1 ]; then printf "partial\\n"; printf "Connection timed out\\n" >&2; return 255; fi; printf "valid-state\\n"; }',
        'GITHUB_ACTIONS_REMOTE_SSH_ATTEMPTS=2 GITHUB_ACTIONS_REMOTE_SSH_RETRY_DELAY_SECONDS=0 github_actions_remote_ssh /tmp/key 22 deploy example.invalid true',
      ].join('; '),
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'valid-state\n');
    assert.doesNotMatch(result.stdout, /partial|SSH attempt/);
  });

  test('resolves remote env files from the explicit target context', () => {
    const result = runProjectCommand('bash', [
      '-lc',
      [
        'source scripts/lib/github-actions-remote.sh',
        'github_actions_remote_ssh() { printf "%s\\n" "$5"; }',
        'TARGET_ENVIRONMENT=staging github_actions_remote_read_env_key /tmp/key 22 deploy 192.0.2.10 CP_BILLING_MODE',
        'TARGET_ENVIRONMENT=production CLASSROOMPATH_DEPLOY_ROOT=/private/classroompath github_actions_remote_read_env_key /tmp/key 22 deploy 192.0.2.10 CP_BILLING_MODE',
      ].join('; '),
    ]);

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /grep '\^CP_BILLING_MODE=' '\/srv\/classroompath\/app\/config\/\.env'/
    );
    assert.match(
      result.stdout,
      /grep '\^CP_BILLING_MODE=' '\/private\/classroompath\/app\/config\/\.env'/
    );
  });
});
