import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
  buildPromotionContractUrl,
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
