import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCommandLine, requireCliOption } from '../scripts/lib/release-cli.mjs';

describe('release cli helpers', () => {
  test('parses commands with named value flags', () => {
    assert.deepEqual(
      parseCommandLine(['resolve-manifest', '--sha', 'target-sha', '--repo', 'owner/repo'], {
        valueFlags: ['--repo', '--sha'],
      }),
      {
        command: 'resolve-manifest',
        options: {
          repo: 'owner/repo',
          sha: 'target-sha',
        },
      }
    );
  });

  test('requires mandatory CLI options through a shared error helper', () => {
    assert.equal(requireCliOption({ sha: 'target-sha' }, 'sha', 'sha is required'), 'target-sha');
    assert.throws(() => requireCliOption({}, 'sha', 'sha is required'), /sha is required/);
  });
});
