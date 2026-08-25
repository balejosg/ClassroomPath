import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deriveWindowsOfflineInstallerTemplateRelease,
  parseWindowsOfflineInstallerTemplateSidecar,
  resolveWindowsOfflineInstallerTemplatePin,
} from '../scripts/resolve-windows-offline-installer-template-pin.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const sha256 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('Windows offline installer release pin resolver', () => {
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
        fetchImpl: async () => new Response('', { status: 404 }),
      }),
      /sidecar download failed/
    );
  });
});
