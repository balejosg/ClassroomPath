import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_OPENPATH_APT_BASE_URL,
  DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
  assertOpenPathLinuxAgentVersionAdvertised,
  assertOpenPathLinuxAgentRuntimePinAdvertised,
  buildAptPackagesUrl,
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

  test('falls back to the nearest ancestor promotion contract for OpenPath commits without package changes', async () => {
    const pinnedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const parentSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const baseUrl = 'https://example.test/contracts';
    const requestedUrls: string[] = [];

    const result = await resolveOpenPathLinuxAgentVersionFromContracts({
      pinnedOpenpathSha: pinnedSha,
      candidateOpenpathShas: [pinnedSha, parentSha, 'cccccccccccccccccccccccccccccccccccccccc'],
      promotionContractsBaseUrl: baseUrl,
      downloadText: async (url) => {
        requestedUrls.push(url);
        if (url.endsWith(`/${pinnedSha}.json`)) {
          const error = new Error('not found');
          (error as Error & { status?: number }).status = 404;
          throw error;
        }

        if (url.endsWith('/dists/unstable/main/binary-amd64/Packages')) {
          return 'Package: openpath-dnsmasq\nVersion: 0.0.412-1\n';
        }

        return JSON.stringify({
          version: 1,
          openpathSha: parentSha,
          packageVersion: '0.0.412',
          linuxAgentVersion: '0.0.412',
          aptSuite: 'unstable',
          firefoxExtensionVersion: '4.1.25',
          browserPolicySpecSha256: 'meta123',
        });
      },
    });

    assert.deepEqual(requestedUrls, [
      `${baseUrl}/${pinnedSha}.json`,
      `${baseUrl}/${parentSha}.json`,
      `${DEFAULT_OPENPATH_APT_BASE_URL}/dists/unstable/main/binary-amd64/Packages`,
    ]);
    assert.deepEqual(result, {
      openpathSha: pinnedSha,
      promotionContractSha: parentSha,
      openpathVersion: '0.0.412',
      version: '0.0.412',
      aptSuite: 'unstable',
    });
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
