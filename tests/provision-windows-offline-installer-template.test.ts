import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import {
  provisionWindowsOfflineInstallerTemplate,
  verifyWindowsOfflineInstallerTemplate,
} from '../scripts/provision-windows-offline-installer-template.mjs';

const tempRoot = mkdtempSync(path.join(tmpdir(), 'cp-woi-provision-'));
const templateHostDir = path.join(tempRoot, 'templates');
const version = '4.1.0';
const commit = `abcdef1${'a'.repeat(33)}`;
const releaseTag = `scripts-v${version}-abcdef1`;
const bytes = Buffer.from('MZ-pinned-template');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function env(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    CP_OFFLINE_INSTALLER_TEMPLATE_VERSION: version,
    CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT: commit,
    CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG: releaseTag,
    CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: sha256,
    CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR: templateHostDir,
    ...overrides,
  };
}

function response(body: Buffer | string, status = 200): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status });
}

function fetchFor(exeBody: Buffer, sidecarBody: string, calls: { count: number }) {
  return async (url: string): Promise<Response> => {
    calls.count += 1;
    assert.match(url, new RegExp(`${releaseTag}/OpenPath-Windows-Setup-Template`));
    return url.endsWith('.sha256') ? response(sidecarBody) : response(exeBody);
  };
}

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

void describe('Windows offline installer template provisioner', () => {
  test('rejects release tags from another version or commit', async () => {
    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env({ CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG: 'scripts-v3.0.0-abcdef1' }),
        fetchImpl: async () => response(bytes),
      }),
      /release tag must start with scripts-v4\.1\.0-/
    );

    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env({ CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG: `scripts-v${version}-1234567` }),
        fetchImpl: async () => response(bytes),
      }),
      /short SHA must prefix the configured full commit/
    );
  });

  test('fails on missing asset, invalid sidecar, or wrong executable hash', async () => {
    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env(),
        fetchImpl: async () => response('missing', 404),
      }),
      /asset download failed with HTTP 404/
    );

    const invalidSidecarCalls = { count: 0 };
    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env(),
        fetchImpl: fetchFor(bytes, 'not-a-digest file\n', invalidSidecarCalls),
      }),
      /sidecar is malformed/
    );

    const wrongHashCalls = { count: 0 };
    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env(),
        fetchImpl: fetchFor(Buffer.from('wrong'), `${sha256} file\n`, wrongHashCalls),
      }),
      /executable bytes do not match configured SHA-256/
    );
  });

  test('publishes valid assets atomically and skips valid repeated provisioning', async () => {
    const calls = { count: 0 };
    const sidecar = `${sha256}  OpenPath-Windows-Setup-Template.exe\n`;
    const first = await provisionWindowsOfflineInstallerTemplate({
      env: env(),
      fetchImpl: fetchFor(bytes, sidecar, calls),
    });

    const destination = path.join(templateHostDir, version, commit);
    const exePath = path.join(destination, 'OpenPath-Windows-Setup-Template.exe');
    const sidecarPath = `${exePath}.sha256`;
    assert.equal(first.status, 'provisioned');
    assert.equal(calls.count, 2);
    assert.equal(readFileSync(exePath).toString(), bytes.toString());
    assert.equal(readFileSync(sidecarPath).toString(), sidecar);
    assert.equal(existsSync(path.join(templateHostDir, 'artifacts')), false);

    const second = await provisionWindowsOfflineInstallerTemplate({
      env: env(),
      fetchImpl: async () => {
        throw new Error('valid template must not redownload');
      },
    });
    assert.equal(second.status, 'already_valid');
  });

  test('uses the Compose-relative default when a legacy host has no HOST_DIR', async () => {
    const composeCwd = path.join(tempRoot, 'docker');
    const expectedRoot = path.resolve(composeCwd, '../var/windows-offline-installer/templates');
    const noHostDirEnv = env({ CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR: undefined });
    await provisionWindowsOfflineInstallerTemplate({
      env: noHostDirEnv,
      cwd: composeCwd,
      fetchImpl: fetchFor(bytes, `${sha256}  OpenPath-Windows-Setup-Template.exe\n`, { count: 0 }),
    });
    assert.equal(
      existsSync(path.join(expectedRoot, version, commit, 'OpenPath-Windows-Setup-Template.exe')),
      true
    );
    rmSync(expectedRoot, { recursive: true, force: true });
  });

  test('publishes a traversable read-only template tree on POSIX', async (t) => {
    if (process.platform === 'win32') {
      t.skip('POSIX mode assertions are not portable to Windows');
    }

    const destination = path.join(templateHostDir, version, commit);
    const exePath = path.join(destination, 'OpenPath-Windows-Setup-Template.exe');
    const sidecarPath = `${exePath}.sha256`;
    const sidecar = `${sha256}  OpenPath-Windows-Setup-Template.exe\n`;
    await provisionWindowsOfflineInstallerTemplate({
      env: env(),
      fetchImpl: fetchFor(bytes, sidecar, { count: 0 }),
    });

    const rootMode = statSync(templateHostDir).mode & 0o777;
    const versionMode = statSync(path.join(templateHostDir, version)).mode & 0o777;
    const commitMode = statSync(destination).mode & 0o777;
    const exeMode = statSync(exePath).mode & 0o777;
    const sidecarMode = statSync(sidecarPath).mode & 0o777;
    assert.equal(rootMode, 0o755);
    assert.equal(versionMode, 0o755);
    assert.equal(commitMode, 0o755);
    assert.equal(exeMode, 0o644);
    assert.equal(sidecarMode, 0o644);
    assert.equal(commitMode & 0o002, 0);
    assert.equal(exeMode & 0o002, 0);
    assert.equal(sidecarMode & 0o002, 0);
  });

  test('reprovisions corrupt state without changing it when download fails', async () => {
    const destination = path.join(templateHostDir, version, commit);
    const exePath = path.join(destination, 'OpenPath-Windows-Setup-Template.exe');
    mkdirSync(destination, { recursive: true });
    writeFileSync(exePath, 'corrupt');
    writeFileSync(`${exePath}.sha256`, `${sha256} file\n`);

    await assert.rejects(
      provisionWindowsOfflineInstallerTemplate({
        env: env(),
        fetchImpl: async () => response('failed', 503),
      }),
      /asset download failed with HTTP 503/
    );
    assert.equal(readFileSync(exePath).toString(), 'corrupt');
  });

  test('--verify-only validates locally and never calls fetch', async () => {
    const sidecar = `${sha256} file\n`;
    const calls = { count: 0 };
    await provisionWindowsOfflineInstallerTemplate({
      env: env(),
      fetchImpl: fetchFor(bytes, sidecar, calls),
    });

    const result = await verifyWindowsOfflineInstallerTemplate({
      env: env(),
    });
    assert.equal(result.status, 'valid');
    assert.equal(calls.count, 2);
  });
});
