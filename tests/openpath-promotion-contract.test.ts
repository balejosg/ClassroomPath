import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
  SUPPORTED_OPENPATH_PROMOTION_INTERFACES,
  buildOpenPathPromotionContractUrl,
  parseOpenPathPromotionContractBytes,
  resolveOpenPathPromotionContract,
} from '../scripts/lib/openpath-promotion-contract.mjs';

const openpathSha = 'a3846d6cbbb5c816d12dc4c5a60409760e121b90';
const otherSha = '0123456789abcdef0123456789abcdef01234567';
const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function buildContract(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion: '4.1.0',
    interfaces: { ...SUPPORTED_OPENPATH_PROMOTION_INTERFACES },
    components: {
      linuxAgent: {
        sourceSha: openpathSha,
        inputsSha256: hash,
        packageName: 'openpath-dnsmasq',
        packageVersion: '0.0.20260830211724-1',
        aptSuite: 'unstable',
        filename: 'pool/unstable/main/openpath-dnsmasq_0.0.20260830211724-1_amd64.deb',
        sha256: hash,
      },
      windowsOfflineInstaller: {
        sourceSha: openpathSha,
        inputsSha256: hash,
        version: '4.1.0',
        releaseTag: 'scripts-v4.1.0-a3846d6',
        templateAsset: 'OpenPath-Windows-Setup-Template.exe',
        templateSha256: hash,
        payloadManifestAsset: 'payload-manifest.json',
        payloadManifestSha256: hash,
      },
      browserPolicy: {
        sourceSha: openpathSha,
        inputsSha256: hash,
        firefoxExtensionVersion: '2.0.1',
        browserPolicySpecSha256: hash,
      },
    },
    ...overrides,
  };
}

function contractBytes(contract = buildContract()) {
  return Buffer.from(JSON.stringify(contract, null, 2) + '\n', 'utf8');
}

function responseFor(bytes: Buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe('exact OpenPath v2 promotion contract', () => {
  test('builds only the immutable v2 URL for the full OpenPath SHA', () => {
    assert.equal(
      DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
      'https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/promotion-contracts/v2'
    );
    assert.equal(
      buildOpenPathPromotionContractUrl({ openpathSha }),
      DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL + '/' + openpathSha + '.json'
    );
  });

  test('preserves downloaded bytes and hashes those bytes, not reserialized JSON', () => {
    const bytes = Buffer.from('\n' + JSON.stringify(buildContract(), null, 2) + '\n\n', 'utf8');
    const result = parseOpenPathPromotionContractBytes(bytes, { expectedOpenpathSha: openpathSha });

    assert.deepEqual(result.contract, buildContract());
    assert.deepEqual(result.contractBytes, bytes);
    assert.equal(result.contractSha256, createHash('sha256').update(bytes).digest('hex'));
  });

  test('fetches exactly one contract URL and never searches ancestors or mutable refs', async () => {
    const bytes = contractBytes();
    const requests: string[] = [];
    const result = await resolveOpenPathPromotionContract({
      openpathSha,
      fetchImpl: async (url: string) => {
        requests.push(url);
        return responseFor(bytes);
      },
    });

    assert.deepEqual(requests, [
      DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL + '/' + openpathSha + '.json',
    ]);
    assert.equal(result.openpathSha, openpathSha);
    assert.equal(result.contract.openpathSha, openpathSha);
    assert.match(result.contractSha256, /^[0-9a-f]{64}$/);
  });

  test('fails closed when the exact contract is unavailable', async () => {
    await assert.rejects(
      resolveOpenPathPromotionContract({
        openpathSha,
        fetchImpl: async () => responseFor(Buffer.from('missing'), 404),
      }),
      /exact OpenPath v2 promotion contract download failed.*404/
    );
  });

  test('fails closed when contract.openpathSha differs from the requested SHA', () => {
    const contract = buildContract({ openpathSha: otherSha });

    assert.throws(
      () =>
        parseOpenPathPromotionContractBytes(contractBytes(contract), {
          expectedOpenpathSha: openpathSha,
        }),
      /does not match the exact OpenPath SHA/
    );
  });

  test('fails closed for unsupported schema, interface, and incomplete component data', () => {
    assert.throws(
      () =>
        parseOpenPathPromotionContractBytes(contractBytes(buildContract({ schemaVersion: 1 })), {
          expectedOpenpathSha: openpathSha,
        }),
      /schemaVersion must be 2/
    );

    assert.throws(
      () =>
        parseOpenPathPromotionContractBytes(
          contractBytes({
            ...buildContract(),
            interfaces: { ...SUPPORTED_OPENPATH_PROMOTION_INTERFACES, readiness: 2 },
          }),
          { expectedOpenpathSha: openpathSha }
        ),
      /interfaces.readiness must be 1/
    );

    const incomplete = buildContract();
    delete (incomplete.components as Record<string, unknown>).browserPolicy;
    assert.throws(
      () =>
        parseOpenPathPromotionContractBytes(contractBytes(incomplete), {
          expectedOpenpathSha: openpathSha,
        }),
      /components.browserPolicy is required/
    );
  });
});
