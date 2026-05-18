import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, test } from 'node:test';

import { runProjectCommand } from './helpers/ops-contracts.ts';

describe('SSH host resolver', () => {
  test('returns literal IPv4 hosts without DNS lookup', () => {
    const result = runProjectCommand('bash', ['scripts/resolve-ssh-host.sh', '192.0.2.10', '22']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ip=192.0.2.10\nport=22\n');
  });

  test('does not treat the nslookup resolver address as the resolved host', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'classroompath-resolve-ssh-host-'));
    const binDir = join(tempRoot, 'bin');
    mkdirSync(binDir);
    writeFileSync(
      join(binDir, 'nslookup'),
      [
        '#!/usr/bin/env bash',
        'cat <<NSLOOKUP',
        'Server:  1.1.1.1',
        'Address: 1.1.1.1',
        '',
        "*** Can't find $1: No answer",
        'NSLOOKUP',
      ].join('\n'),
      { mode: 0o755 }
    );

    const result = runProjectCommand(
      'bash',
      ['scripts/resolve-ssh-host.sh', 'example.invalid', '22', '1'],
      {
        env: {
          PATH: `${binDir}${delimiter}/usr/bin:/bin`,
        },
      }
    );

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ip=1\.1\.1\.1/);
    assert.match(result.stderr, /Could not resolve example\.invalid/);
  });
});
