import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_PACKAGES_URL,
  buildFetchOpenPathTagsArgs,
  parsePublishedOpenPathLinuxVersions,
  resolveOpenPathLinuxAgentVersion,
  selectLatestReachableOpenPathReleaseTag,
  touchesLinuxAgentContract,
} from '../scripts/resolve-openpath-linux-agent-version.mjs';

describe('OpenPath Linux agent version resolution', () => {
  test('uses the raw GitHub apt metadata source instead of legacy GitHub Pages', () => {
    assert.equal(
      DEFAULT_PACKAGES_URL,
      'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/apt/dists/stable/main/binary-amd64/Packages'
    );
    assert.equal(DEFAULT_PACKAGES_URL.includes('balejosg.github.io'), false);
  });

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

  test('deshallows OpenPath before fetching tags when the submodule checkout is shallow', () => {
    assert.deepEqual(buildFetchOpenPathTagsArgs({ shallow: true }).slice(2), [
      'fetch',
      '--force',
      '--tags',
      '--unshallow',
      'origin',
    ]);
    assert.deepEqual(buildFetchOpenPathTagsArgs({ shallow: false }).slice(2), [
      'fetch',
      '--force',
      '--tags',
      'origin',
    ]);
  });

  test('detects Linux agent contract drift for runtime and enrollment paths', () => {
    assert.equal(touchesLinuxAgentContract(['linux/scripts/runtime/openpath-cmd.sh']), true);
    assert.equal(touchesLinuxAgentContract(['windows/scripts/Update-OpenPath.ps1']), true);
    assert.equal(touchesLinuxAgentContract(['firefox-extension/src/background.ts']), true);
    assert.equal(touchesLinuxAgentContract(['runtime/browser-policy-spec.json']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/routes/enrollment.ts']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/lib/server-assets.ts']), true);
    assert.equal(touchesLinuxAgentContract(['api/src/routes/machines.ts']), true);
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
