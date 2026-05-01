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
    assert.match(
      result.stderr,
      /SSH attempt 1\/2 to deploy@192\.0\.2\.10:22 failed \(ssh-timeout\)/
    );
    assert.match(
      result.stderr,
      /SSH attempt 2\/2 to deploy@192\.0\.2\.10:22 failed \(ssh-timeout\)/
    );
    assert.match(
      result.stderr,
      /SSH to deploy@192\.0\.2\.10:22 failed after 2 attempts \(ssh-timeout\)/
    );
  });
});
