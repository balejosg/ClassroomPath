import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parsePublishedOpenPathLinuxVersions,
  resolveOpenPathLinuxAgentVersion,
  selectLatestReachableOpenPathReleaseTag,
  touchesLinuxAgentContract,
} from '../scripts/resolve-openpath-linux-agent-version.mjs';

describe('OpenPath Linux agent version resolution', () => {
  test('selects the latest reachable OpenPath release tag', () => {
    assert.equal(
      selectLatestReachableOpenPathReleaseTag(['v4.1.3', 'v4.1.10', 'scripts-v4.1.11-deadbeef']),
      'v4.1.10'
    );
  });

  test('parses published openpath-dnsmasq versions from APT metadata', () => {
    const versions = parsePublishedOpenPathLinuxVersions(`
Package: openpath-dnsmasq
Version: 4.1.3-1

Package: other-package
Version: 9.9.9-1

Package: openpath-dnsmasq
Version: 4.1.4-1
`);

    assert.deepEqual(versions, ['4.1.3', '4.1.4']);
  });

  test('detects Linux agent contract drift for runtime and enrollment paths', () => {
    assert.equal(touchesLinuxAgentContract(['linux/scripts/runtime/openpath-cmd.sh']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/routes/enrollment.ts']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/lib/server-assets.ts']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/routes/auth.ts']), false);
  });

  test('resolves the published Linux agent version from reachable tags when no drift exists', () => {
    assert.deepEqual(
      resolveOpenPathLinuxAgentVersion({
        publishedVersions: ['4.1.2', '4.1.3'],
        reachableTags: ['v4.1.2', 'v4.1.3'],
        changedFilesSinceTag: [],
      }),
      {
        tag: 'v4.1.3',
        version: '4.1.3',
      }
    );
  });

  test('fails closed when the reachable OpenPath release was not published to APT', () => {
    assert.throws(
      () =>
        resolveOpenPathLinuxAgentVersion({
          publishedVersions: ['4.1.2'],
          reachableTags: ['v4.1.3'],
          changedFilesSinceTag: [],
        }),
      /does not advertise openpath-dnsmasq 4\.1\.3/
    );
  });

  test('fails closed when Linux contract files changed after the latest reachable release', () => {
    assert.throws(
      () =>
        resolveOpenPathLinuxAgentVersion({
          publishedVersions: ['4.1.3'],
          reachableTags: ['v4.1.3'],
          changedFilesSinceTag: ['linux/scripts/runtime/openpath-cmd.sh'],
        }),
      /contains Linux agent changes after v4\.1\.3/
    );
  });
});
