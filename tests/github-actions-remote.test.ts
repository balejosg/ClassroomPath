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
});
