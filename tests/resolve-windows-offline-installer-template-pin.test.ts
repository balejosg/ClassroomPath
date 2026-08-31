import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deriveWindowsOfflineInstallerTemplateRelease,
  parseWindowsOfflineInstallerTemplateSidecar,
  resolveWindowsOfflineInstallerTemplatePin,
  validateWindowsOfflineInstallerTemplatePin,
} from '../scripts/resolve-windows-offline-installer-template-pin.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const sha256 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type WindowsPin = {
  version: string;
  commit: string;
  releaseTag: string;
  sha256: string;
};

const previousPin: WindowsPin = {
  version: '4.1.0',
  commit,
  releaseTag: 'scripts-v4.1.0-01234567',
  sha256,
};

const newPin: WindowsPin = {
  version: '4.2.0',
  commit: 'fedcba9876543210fedcba9876543210fedcba98',
  releaseTag: 'scripts-v4.2.0-fedcba9',
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('Windows offline installer release pin resolver', () => {
  test('CLI fails closed when the contract-derived Windows tuple is absent', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/resolve-windows-offline-installer-template-pin.mjs'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          OPENPATH_SHA: '',
          OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION: '',
          OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: '',
          OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG: '',
          OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256: '',
          PREVIOUS_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION: previousPin.version,
          PREVIOUS_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: previousPin.commit,
          PREVIOUS_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG: previousPin.releaseTag,
          PREVIOUS_OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256: previousPin.sha256,
        },
        encoding: 'utf-8',
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /contract-derived Windows offline installer pin/);
  });

  test('validates a complete contract-derived tuple without selecting a release', () => {
    assert.deepEqual(validateWindowsOfflineInstallerTemplatePin(previousPin), previousPin);
  });

  test('fails closed when the contract-derived tuple is absent', () => {
    assert.throws(
      () => validateWindowsOfflineInstallerTemplatePin({}),
      /complete Windows offline installer pin/
    );
  });

  test('fails closed for every partial contract-derived tuple', () => {
    const fields = Object.keys(previousPin) as Array<keyof WindowsPin>;
    for (let mask = 1; mask < 1 << fields.length; mask += 1) {
      if (mask === (1 << fields.length) - 1) continue;

      const partial = Object.fromEntries(
        fields.filter((_, index) => mask & (1 << index)).map((field) => [field, previousPin[field]])
      );
      assert.throws(
        () => validateWindowsOfflineInstallerTemplatePin(partial),
        /complete Windows offline installer pin/,
        `partial mask ${mask} must fail closed`
      );
    }
  });

  test('validates a complete new tuple explicitly when supplied by the contract', () => {
    assert.deepEqual(validateWindowsOfflineInstallerTemplatePin(newPin), newPin);
  });

  test('fails closed for every partial explicit tuple', () => {
    const fields = Object.keys(newPin) as Array<keyof WindowsPin>;
    for (let mask = 1; mask < 1 << fields.length; mask += 1) {
      if (mask === (1 << fields.length) - 1) continue;

      const partial = Object.fromEntries(
        fields.filter((_, index) => mask & (1 << index)).map((field) => [field, newPin[field]])
      );
      assert.throws(
        () => validateWindowsOfflineInstallerTemplatePin(partial),
        /complete Windows offline installer pin/,
        `partial new mask ${mask} must fail closed`
      );
    }
  });

  test('derives the exact OpenPath release tag from version and full commit', () => {
    const release = deriveWindowsOfflineInstallerTemplateRelease({
      version: '4.1.0',
      commit,
    });

    assert.equal(release.releaseTag, 'scripts-v4.1.0-0123456');
    assert.match(
      release.sidecarUrl,
      /releases\/download\/scripts-v4\.1\.0-0123456\/OpenPath-Windows-Setup-Template\.exe\.sha256$/
    );
  });

  test('preserves the OpenPath git short SHA used by the published release tag', () => {
    const release = deriveWindowsOfflineInstallerTemplateRelease({
      version: '4.1.0',
      commit: 'da3a9c910707f1c565e15239f45ccb808c4588e9',
      shortCommit: 'da3a9c91',
    });

    assert.equal(release.releaseTag, 'scripts-v4.1.0-da3a9c91');
    assert.match(release.sidecarUrl, /scripts-v4\.1\.0-da3a9c91\//);
  });

  test('accepts standard sha256 sidecar format and rejects malformed values', () => {
    assert.equal(
      parseWindowsOfflineInstallerTemplateSidecar(
        `${sha256}  OpenPath-Windows-Setup-Template.exe\n`
      ),
      sha256
    );
    assert.throws(() => parseWindowsOfflineInstallerTemplateSidecar('not-a-sha'), /malformed/);
  });

  test('resolves the checksum from the exact release without resolving branches', async () => {
    const requests: string[] = [];
    const pin = await resolveWindowsOfflineInstallerTemplatePin({
      version: '4.1.0',
      commit,
      shortCommit: '0123456',
      fetchImpl: async (url: string) => {
        requests.push(url);
        return new Response(`${sha256}  OpenPath-Windows-Setup-Template.exe\n`, { status: 200 });
      },
    });

    assert.equal(pin.sha256, sha256);
    assert.deepEqual(requests, [pin.sidecarUrl]);
    assert.equal(
      requests.some((url) => url.includes('latest') || url.includes('main')),
      false
    );
  });

  test('fails closed when the pinned release asset is unavailable', async () => {
    await assert.rejects(
      resolveWindowsOfflineInstallerTemplatePin({
        version: '4.1.0',
        commit,
        shortCommit: '0123456',
        fetchImpl: async () => new Response('', { status: 404 }),
      }),
      /sidecar download failed/
    );
  });
});
