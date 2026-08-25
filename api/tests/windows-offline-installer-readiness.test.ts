import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';

import {
  checkWindowsOfflineInstallerReadiness,
  type WindowsOfflineInstallerReadiness,
} from '../src/lib/windows-offline-installer-readiness.js';

const tempRoot = mkdtempSync(path.join(tmpdir(), 'cp-woi-readiness-'));
const templateDir = path.join(tempRoot, 'templates');
const artifactsDir = path.join(tempRoot, 'artifacts');
const version = '4.1.0';
const commit = 'a'.repeat(40);
const templateBytes = Buffer.from('MZ-template-readiness');
const sha256 = createHash('sha256').update(templateBytes).digest('hex');

function env(): Record<string, string> {
  return {
    CP_OFFLINE_INSTALLER_TEMPLATE_VERSION: version,
    CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT: commit,
    CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: sha256,
    CP_OFFLINE_INSTALLER_TEMPLATE_DIR: templateDir,
    CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: artifactsDir,
    OPENPATH_URL: 'https://openpath.example.test',
  };
}

function writeTemplate(options: { sidecar?: string; bytes?: Buffer } = {}): void {
  const dir = path.join(templateDir, version, commit);
  mkdirSync(dir, { recursive: true });
  const bytes = options.bytes ?? templateBytes;
  writeFileSync(path.join(dir, 'OpenPath-Windows-Setup-Template.exe'), bytes);
  if (options.sidecar !== undefined) {
    writeFileSync(path.join(dir, 'OpenPath-Windows-Setup-Template.exe.sha256'), options.sidecar);
  }
}

function assertCode(
  result: WindowsOfflineInstallerReadiness,
  code: WindowsOfflineInstallerReadiness['code']
): void {
  assert.equal(result.ready, code === 'OK');
  assert.equal(result.code, code);
}

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

void describe('windows offline installer readiness', () => {
  beforeEach(() => {
    rmSync(templateDir, { recursive: true, force: true });
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  test('reports ready after local template/hash and artifact write checks', () => {
    writeTemplate({ sidecar: `${sha256}  OpenPath-Windows-Setup-Template.exe\n` });
    mkdirSync(artifactsDir, { recursive: true });

    const result = checkWindowsOfflineInstallerReadiness({ env: env() });

    assertCode(result, 'OK');
  });

  test('never calls network while checking readiness', () => {
    writeTemplate({ sidecar: `${sha256}  file\n` });
    mkdirSync(artifactsDir, { recursive: true });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('readiness must not fetch');
    }) as typeof fetch;

    try {
      assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'OK');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports config, template, sidecar, hash, and artifact failures', () => {
    assertCode(
      checkWindowsOfflineInstallerReadiness({
        env: { ...env(), CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT: 'short' },
      }),
      'CONFIG_INVALID'
    );

    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'TEMPLATE_MISSING');

    writeTemplate();
    mkdirSync(artifactsDir, { recursive: true });
    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'SIDECAR_MISSING');

    writeTemplate({ sidecar: 'not-a-digest file\n' });
    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'SIDECAR_INVALID');

    writeTemplate({ sidecar: `${'b'.repeat(64)} file\n` });
    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'SIDECAR_HASH_MISMATCH');

    writeTemplate({ sidecar: `${sha256} file\n`, bytes: Buffer.from('different') });
    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'TEMPLATE_HASH_MISMATCH');

    writeTemplate({ sidecar: `${sha256} file\n` });
    rmSync(artifactsDir, { recursive: true, force: true });
    assertCode(checkWindowsOfflineInstallerReadiness({ env: env() }), 'ARTIFACTS_DIR_UNAVAILABLE');
  });

  test('reports artifact directory write failure from effective write probe', () => {
    writeTemplate({ sidecar: `${sha256} file\n` });
    mkdirSync(artifactsDir, { recursive: true });

    assertCode(
      checkWindowsOfflineInstallerReadiness({
        env: env(),
        probeArtifactsWrite: () => {
          throw new Error('read-only');
        },
      }),
      'ARTIFACTS_DIR_NOT_WRITABLE'
    );
  });
});
