import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  getFirefoxReleaseMetadataField,
  getFirefoxReleaseMetadataFieldFromCliArgs,
  parseFirefoxReleaseMetadata,
} from '../scripts/read-firefox-release-metadata.mjs';

describe('Firefox release metadata helper', () => {
  test('parses extension id and version from release metadata', () => {
    assert.deepEqual(
      parseFirefoxReleaseMetadata(
        JSON.stringify({
          extensionId: 'monitor-bloqueos@openpath',
          version: '2.0.0.3001',
          signatureSource: 'amo',
          signatureState: 'signed',
        })
      ),
      {
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.3001',
        signatureSource: 'amo',
        signatureState: 'signed',
      }
    );
  });

  test('returns a required field by name', () => {
    const metadataJson = JSON.stringify({
      extensionId: 'monitor-bloqueos@openpath',
      version: '2.0.0.3001',
      signatureSource: 'amo',
      signatureState: 'signed',
    });

    assert.equal(
      getFirefoxReleaseMetadataField(metadataJson, 'extensionId'),
      'monitor-bloqueos@openpath'
    );
    assert.equal(getFirefoxReleaseMetadataField(metadataJson, 'version'), '2.0.0.3001');
    assert.equal(getFirefoxReleaseMetadataField(metadataJson, 'signatureSource'), 'amo');
    assert.equal(getFirefoxReleaseMetadataField(metadataJson, 'signatureState'), 'signed');
  });

  test('rejects missing required fields with a precise error', () => {
    assert.throws(
      () =>
        getFirefoxReleaseMetadataField(
          JSON.stringify({
            extensionId: 'monitor-bloqueos@openpath',
          }),
          'version'
        ),
      /Firefox release metadata is missing a valid version/
    );
  });

  test('cli helper resolves a requested field from argv plus stdin content', () => {
    const output = getFirefoxReleaseMetadataFieldFromCliArgs(
      ['--field', 'extensionId'],
      JSON.stringify({
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.3001',
        signatureSource: 'amo',
        signatureState: 'signed',
      })
    );

    assert.equal(output, 'monitor-bloqueos@openpath');
  });

  test('cli helper rejects missing field arguments with usage text', () => {
    assert.throws(
      () => getFirefoxReleaseMetadataFieldFromCliArgs([], '{}'),
      /Usage:\n  node scripts\/read-firefox-release-metadata\.mjs --field <extensionId\|version\|signatureSource\|signatureState> < metadata\.json/
    );
  });
});
