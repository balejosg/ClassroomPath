import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runProjectCommand } from './helpers/ops-contracts.ts';

describe('SSH host resolver', () => {
  test('returns literal IPv4 hosts without DNS lookup', () => {
    const result = runProjectCommand('bash', [
      'scripts/resolve-ssh-host.sh',
      'staging-host.example.invalid',
      '22',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ip=staging-host.example.invalid\nport=22\n');
  });
});
