import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  renderOpenPathExactDebSystemdInstallProbeScript,
  renderOpenPathLinuxAgentInstallProbeScript,
  verifyOpenPathPromotionContract,
} from '../scripts/verify-openpath-promotion-contract.mjs';

const openpathSha = 'a3846d6cbbb5c816d12dc4c5a60409760e121b90';
const metadataHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const packageVersion = '0.0.20260830211724-1';
const packageFilename = 'pool/unstable/main/openpath-dnsmasq_0.0.20260830211724-1_amd64.deb';
const packageBytes = Buffer.from('verified package bytes', 'utf8');
const packageHash = createHash('sha256').update(packageBytes).digest('hex');
const templateBytes = Buffer.from('verified template bytes', 'utf8');
const templateHash = createHash('sha256').update(templateBytes).digest('hex');
const payloadManifestBytes = Buffer.from('verified payload manifest bytes', 'utf8');
const payloadManifestHash = createHash('sha256').update(payloadManifestBytes).digest('hex');
const firefoxManifestBytes = Buffer.from(
  JSON.stringify({
    browser_specific_settings: { gecko: { id: 'openpath-block-monitor@openpath' } },
  }),
  'utf8'
);
const firefoxExtensionId = 'openpath-block-monitor@openpath';

function contract() {
  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion: '4.1.0',
    interfaces: { wrapperIntegration: 1, windowsOfflineInstaller: 1, readiness: 1 },
    components: {
      linuxAgent: {
        sourceSha: openpathSha,
        inputsSha256: metadataHash,
        packageName: 'openpath-dnsmasq',
        packageVersion,
        aptSuite: 'unstable',
        filename: packageFilename,
        sha256: packageHash,
      },
      windowsOfflineInstaller: {
        sourceSha: openpathSha,
        inputsSha256: metadataHash,
        version: '4.1.0',
        releaseTag: 'scripts-v4.1.0-a3846d6',
        templateAsset: 'OpenPath-Windows-Setup-Template.exe',
        templateSha256: templateHash,
        payloadManifestAsset: 'payload-manifest.json',
        payloadManifestSha256: payloadManifestHash,
      },
      browserPolicy: {
        sourceSha: openpathSha,
        inputsSha256: metadataHash,
        firefoxExtensionVersion: '2.0.1',
        browserPolicySpecSha256: metadataHash,
      },
    },
  };
}

function contractBytes() {
  return Buffer.from(JSON.stringify(contract(), null, 2) + '\n', 'utf8');
}

function packagesText(version = packageVersion, filename = packageFilename, sha256 = packageHash) {
  return [
    'Package: openpath-dnsmasq',
    'Version: ' + version,
    'Architecture: amd64',
    'Filename: ' + filename,
    'SHA256: ' + sha256,
    '',
  ].join('\n');
}

describe('OpenPath v2 physical provenance verifier', () => {
  test('renders a real exact-version APT installation probe from the v2 contract component', () => {
    const script = renderOpenPathLinuxAgentInstallProbeScript({
      aptBaseUrl: 'https://example.test/apt',
      aptSuite: contract().components.linuxAgent.aptSuite,
      packageName: contract().components.linuxAgent.packageName,
      packageVersion: contract().components.linuxAgent.packageVersion,
    });

    assert.match(
      script,
      /apt-get install -y --no-install-recommends 'openpath-dnsmasq=0\.0\.20260830211724-1'/u
    );
    assert.match(script, /apt-get check/u);
    assert.match(script, /dpkg-query -W/u);
    assert.doesNotMatch(script, /--download-only/u);
  });

  test('renders a systemd probe that installs the exact verified .deb bytes', () => {
    const script = renderOpenPathExactDebSystemdInstallProbeScript({
      packageName: contract().components.linuxAgent.packageName,
      packageVersion,
      packageSha256: packageHash,
      packageBytes,
    });

    assert.match(script, /base64 --decode[\s\S]*openpath-package\.deb/u);
    assert.match(script, new RegExp(packageBytes.toString('base64'), 'u'));
    assert.match(script, new RegExp(packageHash, 'u'));
    assert.match(script, /FROM ubuntu:24\.04/u);
    assert.match(script, /CMD \["\/lib\/systemd\/systemd"\]/u);
    assert.match(script, /docker run --detach[\s\S]*--privileged/u);
    assert.match(
      script,
      /apt-get install -y --no-install-recommends \/tmp\/openpath-package\.deb/u
    );
    assert.match(script, /apt-get check/u);
    assert.match(script, /systemctl is-active --quiet dnsmasq/u);
    assert.match(script, /systemctl is-enabled openpath-dnsmasq\.timer/u);
    assert.doesNotMatch(script, /apt-setup\.sh/u);
  });

  test('verifies the exact contract, APT tuple, and package bytes without selecting a version', async () => {
    const requests: string[] = [];
    const result = await verifyOpenPathPromotionContract({
      contractBytes: contractBytes(),
      expectedOpenpathSha: openpathSha,
      aptBaseUrl: 'https://example.test/apt',
      downloadText: async (url: string) => {
        requests.push(url);
        return packagesText();
      },
      downloadBytes: async (url: string) => {
        requests.push(url);
        return packageBytes;
      },
      downloadReleaseAssetBytes: async (url: string) => {
        requests.push(url);
        return url.endsWith('/OpenPath-Windows-Setup-Template.exe')
          ? templateBytes
          : payloadManifestBytes;
      },
      openpathManifestBytes: firefoxManifestBytes,
      extractFirefoxManagedExtensionId: () => firefoxExtensionId,
    });

    assert.equal(result.openpathSha, openpathSha);
    assert.equal(result.linuxAgent.packageVersion, packageVersion);
    assert.equal(result.linuxAgent.filename, packageFilename);
    assert.equal(result.linuxAgent.sha256, packageHash);
    assert.equal(result.linuxAgentFirefoxExtensionId, firefoxExtensionId);
    assert.equal(result.firefoxManifestGeckoId, firefoxExtensionId);
    assert.match(result.contractSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(requests, [
      'https://example.test/apt/dists/unstable/main/binary-amd64/Packages',
      'https://example.test/apt/' + packageFilename,
      'https://github.com/balejosg/OpenPath/releases/download/scripts-v4.1.0-a3846d6/OpenPath-Windows-Setup-Template.exe',
      'https://github.com/balejosg/OpenPath/releases/download/scripts-v4.1.0-a3846d6/payload-manifest.json',
    ]);
  });

  test('fails closed when APT metadata does not contain the contract package tuple', async () => {
    await assert.rejects(
      verifyOpenPathPromotionContract({
        contractBytes: contractBytes(),
        expectedOpenpathSha: openpathSha,
        downloadText: async () => packagesText('0.0.0-1'),
        downloadBytes: async () => packageBytes,
      }),
      /does not contain the exact openpath-dnsmasq package tuple/
    );
  });

  test('fails closed when downloaded package bytes differ from contract SHA-256', async () => {
    await assert.rejects(
      verifyOpenPathPromotionContract({
        contractBytes: contractBytes(),
        expectedOpenpathSha: openpathSha,
        downloadText: async () => packagesText(),
        downloadBytes: async () => Buffer.from('tampered package bytes', 'utf8'),
      }),
      /does not match the contract SHA-256/
    );
  });

  test('compares the Firefox ID from the exact validated .deb with the pinned OpenPath manifest', async () => {
    let extractedBytes: Buffer | undefined;
    const result = await verifyOpenPathPromotionContract({
      contractBytes: contractBytes(),
      expectedOpenpathSha: openpathSha,
      aptPackagesContent: packagesText(),
      linuxArtifactBytes: packageBytes,
      openpathManifestBytes: firefoxManifestBytes,
      extractFirefoxManagedExtensionId: (bytes: Buffer) => {
        extractedBytes = bytes;
        return firefoxExtensionId;
      },
      downloadReleaseAssetBytes: async (url: string) =>
        url.endsWith('/OpenPath-Windows-Setup-Template.exe') ? templateBytes : payloadManifestBytes,
    });

    assert.deepEqual(extractedBytes, packageBytes);
    assert.equal(result.linuxAgentFirefoxExtensionId, firefoxExtensionId);
  });

  test('fails closed when the exact .deb Firefox ID differs from the pinned manifest', async () => {
    await assert.rejects(
      verifyOpenPathPromotionContract({
        contractBytes: contractBytes(),
        expectedOpenpathSha: openpathSha,
        aptPackagesContent: packagesText(),
        linuxArtifactBytes: packageBytes,
        openpathManifestBytes: firefoxManifestBytes,
        extractFirefoxManagedExtensionId: () => 'wrong-extension@openpath',
        downloadReleaseAssetBytes: async (url: string) =>
          url.endsWith('/OpenPath-Windows-Setup-Template.exe')
            ? templateBytes
            : payloadManifestBytes,
      }),
      /Firefox extension ID mismatch/u
    );
  });
});
