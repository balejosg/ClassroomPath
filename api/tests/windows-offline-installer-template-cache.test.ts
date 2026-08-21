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

writePinnedTemplate('4.1.0', 'abc123', TEMPLATE_SHA);

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

void describe('windows-offline-installer template cache', () => {
  void test('loads a matching cached template and reports its coordinates', () => {
    const template = loadCachedWindowsOfflineTemplate(tempRoot, {
      version: '4.1.0',
      commit: 'abc123',
      sha256: TEMPLATE_SHA,
    });

    assert.equal(template.version, '4.1.0');
    assert.equal(template.commit, 'abc123');
    assert.equal(template.sha256, TEMPLATE_SHA);
  });

  void test('fails closed on missing version/commit, bad sidecar, or hash mismatch', () => {
    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '9.9.9',
          commit: 'abc123',
          sha256: TEMPLATE_SHA,
        }),
      WindowsOfflineTemplateCacheError
    );

    const staleDir = path.join(tempRoot, '4.1.0', 'deadbeef');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(staleDir, 'OpenPath-Windows-Setup-Template.exe'), TEMPLATE_BYTES);
    writeFileSync(
      path.join(staleDir, 'OpenPath-Windows-Setup-Template.exe.sha256'),
      `${'b'.repeat(64)}  file\n`
    );

    assert.throws(
      () =>
        loadCachedWindowsOfflineTemplate(tempRoot, {
          version: '4.1.0',
          commit: 'deadbeef',
          sha256: TEMPLATE_SHA,
        }),
      /sidecar/
    );
  });
});
