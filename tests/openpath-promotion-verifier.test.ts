import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { verifyOpenPathPromotionContract } from '../scripts/verify-openpath-promotion-contract.mjs';

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
    });

    assert.equal(result.openpathSha, openpathSha);
    assert.equal(result.linuxAgent.packageVersion, packageVersion);
    assert.equal(result.linuxAgent.filename, packageFilename);
    assert.equal(result.linuxAgent.sha256, packageHash);
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
});
