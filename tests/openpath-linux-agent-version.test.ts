import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_OPENPATH_APT_BASE_URL,
  DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
  assertOpenPathLinuxAgentVersionAdvertised,
  assertOpenPathLinuxAgentRuntimePinAdvertised,
  assertLinuxAgentExtensionIdMatchesManifest,
  assertOpenPathLinuxAgentExtensionIdConsistent,
  buildAptPackagesUrl,
  findOpenPathDnsmasqDebFilename,
  parseFirefoxPolicyManagedExtensionId,
  readManifestGeckoId,
  renderOpenPathLinuxAgentInstallProbeScript,
  buildPromotionContractUrl,
  parseOpenPathDnsmasqAptVersions,
  parseOpenPathPromotionContract,
  resolveOpenPathLinuxAgentVersionFromContracts,
  resolveOpenPathLinuxAgentVersion,
} from '../scripts/resolve-openpath-linux-agent-version.mjs';

describe('OpenPath Linux agent version resolution', () => {
  test('uses published OpenPath promotion contracts instead of inferring from stable APT state', () => {
    assert.equal(
      DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
      'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/promotion-contracts'
    );
    assert.equal(DEFAULT_PROMOTION_CONTRACTS_BASE_URL.includes('promotion-contracts'), true);
  });

  test('derives the promotion contract URL from the exact pinned OpenPath SHA', () => {
    assert.equal(
      buildPromotionContractUrl({
        baseUrl: DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
        openpathSha: '0123456789abcdef0123456789abcdef01234567',
      }),
      'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/promotion-contracts/0123456789abcdef0123456789abcdef01234567.json'
    );
  });

  test('derives the APT Packages URL from the selected suite', () => {
    assert.equal(
      DEFAULT_OPENPATH_APT_BASE_URL,
      'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/apt'
    );
    assert.equal(
      buildAptPackagesUrl({
        baseUrl: DEFAULT_OPENPATH_APT_BASE_URL,
        aptSuite: 'unstable',
      }),
      'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/apt/dists/unstable/main/binary-amd64/Packages'
    );
  });

  test('parses a typed OpenPath promotion contract payload', () => {
    assert.deepEqual(
      parseOpenPathPromotionContract(
        JSON.stringify({
          version: 1,
          openpathSha: '0123456789abcdef0123456789abcdef01234567',
          packageVersion: '0.0.412',
          linuxAgentVersion: '0.0.412',
          aptSuite: 'unstable',
          firefoxExtensionVersion: '4.1.25',
          browserPolicySpecSha256: 'meta123',
        })
      ),
      {
        version: 1,
        openpathSha: '0123456789abcdef0123456789abcdef01234567',
        packageVersion: '0.0.412',
        linuxAgentVersion: '0.0.412',
        aptSuite: 'unstable',
        firefoxExtensionVersion: '4.1.25',
        browserPolicySpecSha256: 'meta123',
      }
    );
  });

  test('resolves the pinned Linux agent version from the published promotion contract', () => {
    assert.deepEqual(
      resolveOpenPathLinuxAgentVersion({
        openpathSha: '0123456789abcdef0123456789abcdef01234567',
        promotionContract: {
          version: 1,
          openpathSha: '0123456789abcdef0123456789abcdef01234567',
          packageVersion: '0.0.412',
          linuxAgentVersion: '0.0.412',
          aptSuite: 'unstable',
          firefoxExtensionVersion: '4.1.25',
          browserPolicySpecSha256: 'meta123',
        },
      }),
      {
        openpathVersion: '0.0.412',
        version: '0.0.412',
        aptSuite: 'unstable',
      }
    );
  });

  test('parses openpath-dnsmasq versions from APT metadata', () => {
    assert.deepEqual(
      parseOpenPathDnsmasqAptVersions(`
Package: other
Version: 1.0.0-1

Package: openpath-dnsmasq
Version: 0.0.20260417203821-1
Architecture: all
`),
      ['0.0.20260417203821']
    );
  });

  test('fails closed when the promotion contract version is missing from selected APT metadata', () => {
    assert.throws(
      () =>
        assertOpenPathLinuxAgentVersionAdvertised({
          aptPackagesContent: 'Package: openpath-dnsmasq\nVersion: 0.0.20260417203821-1\n',
          linuxAgentVersion: '0.0.1382',
          aptSuite: 'unstable',
        }),
      /is not advertised by the unstable APT metadata/
    );
  });

  test('verifies the runtime Linux agent pin against current APT metadata', async () => {
    const requestedUrls: string[] = [];

    await assertOpenPathLinuxAgentRuntimePinAdvertised({
      aptBaseUrl: 'https://example.test/apt',
      aptSuite: 'unstable',
      linuxAgentVersion: '0.0.20260421051157',
      downloadText: async (url) => {
        requestedUrls.push(url);
        return 'Package: openpath-dnsmasq\nVersion: 0.0.20260421051157-1\n';
      },
    });

    assert.deepEqual(requestedUrls, [
      'https://example.test/apt/dists/unstable/main/binary-amd64/Packages',
    ]);
  });

  test('fails closed when the runtime Linux agent pin is stale against current APT metadata', async () => {
    await assert.rejects(
      () =>
        assertOpenPathLinuxAgentRuntimePinAdvertised({
          aptBaseUrl: 'https://example.test/apt',
          aptSuite: 'unstable',
          linuxAgentVersion: '0.0.20260421043406',
          downloadText: async () => 'Package: openpath-dnsmasq\nVersion: 0.0.20260421051157-1\n',
        }),
      /0\.0\.20260421043406 is not advertised by the unstable APT metadata/
    );
  });

  test('renders a disposable APT installability probe for the exact Linux agent pin', () => {
    const script = renderOpenPathLinuxAgentInstallProbeScript({
      aptBaseUrl: 'https://example.test/apt',
      aptSuite: 'unstable',
      linuxAgentVersion: '0.0.20260421051157',
    });

    assert.match(script, /OPENPATH_APT_REPO_URL='https:\/\/example\.test\/apt'/);
    assert.match(script, /apt-setup\.sh" \| bash -s -- --unstable/);
    assert.match(script, /apt-cache show 'openpath-dnsmasq=0\.0\.20260421051157-1'/);
    assert.match(
      script,
      /apt-get install -y --download-only 'openpath-dnsmasq=0\.0\.20260421051157-1'/
    );
  });

  test('fails closed instead of falling back to an ancestor promotion contract', async () => {
    const pinnedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const parentSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const baseUrl = 'https://example.test/contracts';
    const requestedUrls: string[] = [];

    await assert.rejects(
      () =>
        resolveOpenPathLinuxAgentVersionFromContracts({
          pinnedOpenpathSha: pinnedSha,
          promotionContractsBaseUrl: baseUrl,
          downloadText: async (url) => {
            requestedUrls.push(url);
            const error = new Error('not found');
            (error as Error & { status?: number }).status = 404;
            throw error;
          },
        }),
      /not found/
    );

    assert.deepEqual(requestedUrls, [`${baseUrl}/${pinnedSha}.json`]);
  });

  test('fails closed when the published promotion contract does not match the pinned SHA', () => {
    assert.throws(
      () =>
        resolveOpenPathLinuxAgentVersion({
          openpathSha: '0123456789abcdef0123456789abcdef01234567',
          promotionContract: {
            version: 1,
            openpathSha: '89abcdef0123456789abcdef0123456789abcdef',
            packageVersion: '0.0.412',
            linuxAgentVersion: '0.0.412',
            aptSuite: 'unstable',
            firefoxExtensionVersion: '4.1.25',
            browserPolicySpecSha256: 'meta123',
          },
        }),
      /does not match the pinned OpenPath SHA/
    );
  });

  test('fails closed when the promotion contract omits the Linux agent version', () => {
    assert.throws(
      () =>
        resolveOpenPathLinuxAgentVersion({
          openpathSha: '0123456789abcdef0123456789abcdef01234567',
          promotionContract: {
            version: 1,
            openpathSha: '0123456789abcdef0123456789abcdef01234567',
            packageVersion: '0.0.412',
            linuxAgentVersion: '',
            aptSuite: 'unstable',
            firefoxExtensionVersion: '4.1.25',
            browserPolicySpecSha256: 'meta123',
          },
        }),
      /linuxAgentVersion/
    );
  });
});

describe('OpenPath Linux agent Firefox extension-id consistency (max12 guard)', () => {
  const MANIFEST = JSON.stringify({
    browser_specific_settings: { gecko: { id: 'openpath-block-monitor@openpath' } },
  });
  const policyScript = (id: string) =>
    `#!/bin/bash\nFIREFOX_MANAGED_EXTENSION_ID="\${FIREFOX_MANAGED_EXTENSION_ID:-${id}}"\n`;

  test('reads the served XPI gecko id from the pinned submodule manifest', () => {
    assert.equal(readManifestGeckoId(MANIFEST), 'openpath-block-monitor@openpath');
    assert.equal(
      readManifestGeckoId(JSON.stringify({ applications: { gecko: { id: 'legacy@x' } } })),
      'legacy@x'
    );
    assert.throws(() => readManifestGeckoId('{}'), /no gecko id/);
  });

  test('parses the managed-extension id baked into a shipped firefox-policy.sh', () => {
    assert.equal(
      parseFirefoxPolicyManagedExtensionId(policyScript('openpath-block-monitor@openpath')),
      'openpath-block-monitor@openpath'
    );
    assert.equal(
      parseFirefoxPolicyManagedExtensionId(policyScript('monitor-bloqueos@openpath')),
      'monitor-bloqueos@openpath'
    );
    assert.throws(() => parseFirefoxPolicyManagedExtensionId('nothing here'), /Could not find/);
  });

  test('finds the .deb Filename for the blessed version (strips the debian revision)', () => {
    const packages =
      'Package: openpath-dnsmasq\nVersion: 4.1.25-1\nFilename: pool/stable/main/openpath-dnsmasq_4.1.25-1_amd64.deb\n\n' +
      'Package: openpath-dnsmasq\nVersion: 4.1.26-1\nFilename: pool/stable/main/openpath-dnsmasq_4.1.26-1_amd64.deb\n';
    assert.equal(
      findOpenPathDnsmasqDebFilename(packages, '4.1.26'),
      'pool/stable/main/openpath-dnsmasq_4.1.26-1_amd64.deb'
    );
    assert.throws(
      () => findOpenPathDnsmasqDebFilename(packages, '4.1.99'),
      /no openpath-dnsmasq Filename/
    );
  });

  test('passes when the blessed agent .deb id matches the manifest gecko id', () => {
    assert.doesNotThrow(() =>
      assertLinuxAgentExtensionIdMatchesManifest({
        linuxAgentVersion: '4.1.26',
        agentExtensionId: 'openpath-block-monitor@openpath',
        manifestGeckoId: 'openpath-block-monitor@openpath',
      })
    );
  });

  test('fails closed when the blessed agent .deb id is the pre-rename legacy id (the max12 bug)', () => {
    assert.throws(
      () =>
        assertLinuxAgentExtensionIdMatchesManifest({
          linuxAgentVersion: '0.0.20260507111458',
          agentExtensionId: 'monitor-bloqueos@openpath',
          manifestGeckoId: 'openpath-block-monitor@openpath',
        }),
      /firefox_registration_missing/
    );
  });

  test('end-to-end: rejects a pinned version whose served .deb carries the legacy id', async () => {
    const fetched: string[] = [];
    await assert.rejects(
      () =>
        assertOpenPathLinuxAgentExtensionIdConsistent({
          aptBaseUrl: 'https://example.test/apt',
          aptSuite: 'unstable',
          linuxAgentVersion: '0.0.20260507111458',
          manifestGeckoId: 'openpath-block-monitor@openpath',
          downloadText: async (url: string) => {
            fetched.push(url);
            return 'Package: openpath-dnsmasq\nVersion: 0.0.20260507111458-1\nFilename: pool/unstable/main/openpath-dnsmasq_0.0.20260507111458-1_amd64.deb\n';
          },
          downloadBuffer: async (url: string) => {
            fetched.push(url);
            return Buffer.from('deb-bytes');
          },
          extractId: () => 'monitor-bloqueos@openpath',
        }),
      /ships managed-extension id 'monitor-bloqueos@openpath'/
    );
    assert.deepEqual(fetched, [
      'https://example.test/apt/dists/unstable/main/binary-amd64/Packages',
      'https://example.test/apt/pool/unstable/main/openpath-dnsmasq_0.0.20260507111458-1_amd64.deb',
    ]);
  });

  test('end-to-end: accepts a pinned version whose served .deb carries the manifest id', async () => {
    const agentId = await assertOpenPathLinuxAgentExtensionIdConsistent({
      aptBaseUrl: 'https://example.test/apt',
      aptSuite: 'stable',
      linuxAgentVersion: '4.1.26',
      manifestGeckoId: 'openpath-block-monitor@openpath',
      downloadText: async () =>
        'Package: openpath-dnsmasq\nVersion: 4.1.26-1\nFilename: pool/stable/main/openpath-dnsmasq_4.1.26-1_amd64.deb\n',
      downloadBuffer: async () => Buffer.from('deb-bytes'),
      extractId: () => 'openpath-block-monitor@openpath',
    });
    assert.equal(agentId, 'openpath-block-monitor@openpath');
  });
});
