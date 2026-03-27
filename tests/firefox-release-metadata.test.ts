import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFirefoxReleaseMetadataField,
  parseFirefoxReleaseMetadata,
} from '../scripts/read-firefox-release-metadata.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const metadataScriptPath = resolve(testDir, '../scripts/read-firefox-release-metadata.mjs');

describe('Firefox release metadata helper', () => {
  test('parses extension id and version from release metadata', () => {
    assert.deepEqual(
      parseFirefoxReleaseMetadata(
        JSON.stringify({
          extensionId: 'monitor-bloqueos@openpath',
          version: '2.0.0.3001',
        })
      ),
      {
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.3001',
      }
    );
  });

  test('returns a required field by name', () => {
    const metadataJson = JSON.stringify({
      extensionId: 'monitor-bloqueos@openpath',
      version: '2.0.0.3001',
    });

    assert.equal(
      getFirefoxReleaseMetadataField(metadataJson, 'extensionId'),
      'monitor-bloqueos@openpath'
    );
    assert.equal(getFirefoxReleaseMetadataField(metadataJson, 'version'), '2.0.0.3001');
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

  test('cli prints a requested field from stdin', () => {
    const output = execFileSync('node', [metadataScriptPath, '--field', 'extensionId'], {
      encoding: 'utf8',
      input: JSON.stringify({
        extensionId: 'monitor-bloqueos@openpath',
        version: '2.0.0.3001',
      }),
    }).trim();

    assert.equal(output, 'monitor-bloqueos@openpath');
  });
});
