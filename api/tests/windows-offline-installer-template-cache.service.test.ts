import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import {
  loadCachedWindowsOfflineTemplate,
  WindowsOfflineTemplateCacheError,
} from '../src/services/windows-offline-installer-template-cache.service.js';

const SLOT_LENGTH = 65536;

function serializeTrailerPlaceholder(): Buffer {
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      apiUrl: 'https://template-placeholder.invalid',
      classroomId: 'template-placeholder',
      enrollmentToken: 'template-placeholder-token',
      enrollmentTokenExpiresAt: '2036-01-01T00:00:00.000Z',
      captivePortalDomains: [],
      options: {
        approvedStudentBrowsers: ['Firefox'],
        installFirefoxIfMissing: true,
        enforceManagedBrowserBoundary: true,
      },
    }),
    'utf8'
  );
  const header = Buffer.concat([
    Buffer.from('OPWSI1\0\0', 'latin1'),
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(1);
      return b;
    })(),
    Buffer.alloc(2),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(payload.length);
      return b;
    })(),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(SLOT_LENGTH);
      return b;
    })(),
    createHash('sha256').update(payload).digest(),
  ]);
  const slot = Buffer.alloc(SLOT_LENGTH);
  payload.copy(slot, 0);
  const epilogue = Buffer.concat([
    Buffer.from('OPWS', 'latin1'),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(SLOT_LENGTH);
      return b;
    })(),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(52);
      return b;
    })(),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(16);
      return b;
    })(),
  ]);
  return Buffer.concat([header, slot, epilogue]);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'cp-woi-template-'));

function writePinnedTemplate(version: string, commit: string, sha256: string): void {
  const dir = path.join(tempRoot, version, commit);
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.concat([Buffer.from('MZ-template'), serializeTrailerPlaceholder()]);
  writeFileSync(path.join(dir, 'OpenPath-Windows-Setup-Template.exe'), bytes);
  writeFileSync(path.join(dir, 'OpenPath-Windows-Setup-Template.exe.sha256'), `${sha256}  file\n`);
}

const TEMPLATE_BYTES = Buffer.concat([Buffer.from('MZ-template'), serializeTrailerPlaceholder()]);
const TEMPLATE_SHA = createHash('sha256').update(TEMPLATE_BYTES).digest('hex');
const TEMPLATE_COMMIT = 'a'.repeat(40);

writePinnedTemplate('4.1.0', TEMPLATE_COMMIT, TEMPLATE_SHA);

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

void describe('windows-offline-installer template cache', () => {
  void test('loads a matching cached template and reports its coordinates', () => {
    const template = loadCachedWindowsOfflineTemplate(tempRoot, {
      version: '4.1.0',
      commit: TEMPLATE_COMMIT,
      sha256: TEMPLATE_SHA,
    });

    assert.equal(template.version, '4.1.0');
    assert.equal(template.commit, TEMPLATE_COMMIT);
    assert.equal(template.sha256, TEMPLATE_SHA);
  });

  void test('fails closed on missing version or full commit', () => {
    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '9.9.9',
          commit: TEMPLATE_COMMIT,
          sha256: TEMPLATE_SHA,
        }),
      WindowsOfflineTemplateCacheError
    );

    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.0',
          commit: 'b'.repeat(40),
          sha256: TEMPLATE_SHA,
        }),
      WindowsOfflineTemplateCacheError
    );
  });

  void test('fails closed when sidecar is missing or malformed', () => {
    const missingSidecarDir = path.join(tempRoot, '4.1.1', TEMPLATE_COMMIT);
    mkdirSync(missingSidecarDir, { recursive: true });
    writeFileSync(
      path.join(missingSidecarDir, 'OpenPath-Windows-Setup-Template.exe'),
      TEMPLATE_BYTES
    );
    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.1',
          commit: TEMPLATE_COMMIT,
          sha256: TEMPLATE_SHA,
        }),
      /missing its \.sha256 sidecar/
    );

    const malformedSidecarDir = path.join(tempRoot, '4.1.2', TEMPLATE_COMMIT);
    mkdirSync(malformedSidecarDir, { recursive: true });
    writeFileSync(
      path.join(malformedSidecarDir, 'OpenPath-Windows-Setup-Template.exe'),
      TEMPLATE_BYTES
    );
    writeFileSync(
      path.join(malformedSidecarDir, 'OpenPath-Windows-Setup-Template.exe.sha256'),
      'not-a-digest  file\n'
    );
    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.2',
          commit: TEMPLATE_COMMIT,
          sha256: TEMPLATE_SHA,
        }),
      /sidecar is malformed/
    );
  });

  void test('fails closed when sidecar or template bytes disagree with config', () => {
    const staleDir = path.join(tempRoot, '4.1.3', TEMPLATE_COMMIT);
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(staleDir, 'OpenPath-Windows-Setup-Template.exe'), TEMPLATE_BYTES);
    writeFileSync(
      path.join(staleDir, 'OpenPath-Windows-Setup-Template.exe.sha256'),
      `${'b'.repeat(64)}  file\n`
    );

    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.3',
          commit: TEMPLATE_COMMIT,
          sha256: TEMPLATE_SHA,
        }),
      /sidecar does not match/
    );

    const bytesMismatchDir = path.join(tempRoot, '4.1.4', TEMPLATE_COMMIT);
    mkdirSync(bytesMismatchDir, { recursive: true });
    writeFileSync(
      path.join(bytesMismatchDir, 'OpenPath-Windows-Setup-Template.exe'),
      Buffer.from('different-template')
    );
    writeFileSync(
      path.join(bytesMismatchDir, 'OpenPath-Windows-Setup-Template.exe.sha256'),
      `${TEMPLATE_SHA}  file\n`
    );

    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.4',
          commit: TEMPLATE_COMMIT,
          sha256: TEMPLATE_SHA,
        }),
      /bytes do not match/
    );
  });
});
