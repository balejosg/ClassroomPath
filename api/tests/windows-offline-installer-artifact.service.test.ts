import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';

const { WINDOWS_OFFLINE_INSTALLER_CONFIG_SCHEMA } =
  await import('@openpath/shared/windows-offline-installer');
const {
  createWindowsOfflineInstallerService,
  sanitizeWindowsInstallerFileName,
  WindowsOfflineInstallerError,
} = await import('../src/services/windows-offline-installer-artifact.service.js');

const SLOT_LENGTH = 65536;

function buildTemplateBytes(): Buffer {
  const payload = Buffer.from(
    JSON.stringify(
      WINDOWS_OFFLINE_INSTALLER_CONFIG_SCHEMA.parse({
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
      })
    ),
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
  return Buffer.concat([
    Buffer.from('MZ-template'),
    header,
    slot,
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
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'cp-woi-artifact-'));
const templateDir = path.join(tempRoot, 'templates');
const artifactsDir = path.join(tempRoot, 'artifacts');
const templateCommit = 'c'.repeat(40);
let templateSha256 = '';
const templateBaseLength = Buffer.byteLength('MZ-template');

before(() => {
  const templateBytes = buildTemplateBytes();
  templateSha256 = createHash('sha256').update(templateBytes).digest('hex');
  const dir = path.join(templateDir, '9.9.9', templateCommit);
  mkdirSync(dir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(path.join(dir, 'OpenPath-Windows-Setup-Template.exe'), templateBytes);
  writeFileSync(
    path.join(dir, 'OpenPath-Windows-Setup-Template.exe.sha256'),
    `${templateSha256}  x\n`
  );

  process.env.CP_OFFLINE_INSTALLER_TEMPLATE_VERSION = '9.9.9';
  process.env.CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT = templateCommit;
  process.env.CP_OFFLINE_INSTALLER_TEMPLATE_SHA256 = templateSha256;
  process.env.CP_OFFLINE_INSTALLER_TEMPLATE_DIR = templateDir;
  process.env.CP_OFFLINE_INSTALLER_ARTIFACTS_DIR = artifactsDir;
  process.env.OPENPATH_URL = 'https://openpath.example.test';
});

after(() => {
  delete process.env.CP_OFFLINE_INSTALLER_TEMPLATE_VERSION;
  delete process.env.CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT;
  delete process.env.CP_OFFLINE_INSTALLER_TEMPLATE_SHA256;
  delete process.env.CP_OFFLINE_INSTALLER_TEMPLATE_DIR;
  delete process.env.CP_OFFLINE_INSTALLER_ARTIFACTS_DIR;
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeDeps(options: { failMint?: boolean; failPublish?: boolean } = {}) {
  let mintCalls = 0;
  let invalidationCalls = 0;
  const refs = {
    async mintReference(input: Record<string, unknown>) {
      mintCalls += 1;
      if (options.failMint) throw new Error('mint exploded');
      return {
        ref: {
          id: 'ref-1',
          referenceHash: 'f'.repeat(64),
          expiresAt: new Date('2026-08-21T12:10:00.000Z'),
          usedAttempts: 0,
          maxAttempts: input.maxAttempts as number,
        },
        rawToken: 'opaque-reference-token',
      };
    },
    async consumeAttempt() {
      throw new Error('not used');
    },
    async markConsumed() {},
    async invalidateReference() {
      invalidationCalls += 1;
    },
  };

  const ticketClient = async () => ({
    enrollmentToken: 'ticket-token',
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    classroomId: 'room-1',
    classroomName: 'Math A',
  });

  const service = createWindowsOfflineInstallerService({
    refs: refs as never,
    ticketClient: ticketClient as never,
    assertAccess: (async () => {}) as never,
    findClassroom: (async () => ({
      id: 'room-1',
      name: 'Math <A> "B"',
      captivePortalDomains: ['login.example.test'],
    })) as never,
    renameArtifact: options.failPublish
      ? () => {
          throw new Error('publish exploded');
        }
      : undefined,
  });

  return {
    service,
    mintCalls,
    get invalidationCalls() {
      return invalidationCalls;
    },
  };
}

describe('windows-offline-installer artifact service', () => {
  test('sanitizes classroom names into safe installer filenames', () => {
    assert.equal(
      sanitizeWindowsInstallerFileName('Math & Physics "5ºB"'),
      'OpenPath-Math-Physics-5oB-Windows-Setup.exe'
    );
    assert.equal(
      sanitizeWindowsInstallerFileName('../../etc/passwd'),
      'OpenPath-etcpasswd-Windows-Setup.exe'
    );
    assert.equal(sanitizeWindowsInstallerFileName('   '), 'OpenPath-classroom-Windows-Setup.exe');
  });

  test('customizes the pinned template, publishes atomically, and returns a redacted DTO', async () => {
    const { service } = makeDeps();
    const artifact = await service.generate(
      { organizationId: 'org-1', actorUserId: 'user-1', classroomId: 'room-1' },
      { accessToken: 'access-token' }
    );

    assert.ok(existsSync(artifact.artifactPath));
    assert.equal(path.dirname(artifact.artifactPath), artifactsDir);
    assert.ok(!artifact.artifactPath.startsWith(templateDir));
    assert.ok(
      !JSON.stringify({ ...artifact, artifactPath: '', reference: '' }).includes('ticket-token')
    );
    assert.equal(artifact.fileName, 'OpenPath-Math-A-B-Windows-Setup.exe');
    assert.match(artifact.downloadUrl, /^\/cp\/api\/windows-offline-installer\/download\?ref=/);

    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(artifact.artifactPath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
    assert.equal(bytes.length, templateBaseLength + 52 + SLOT_LENGTH + 16);
    assert.ok(!bytes.toString('latin1').includes('template-placeholder-token'));

    rmSync(artifact.artifactPath, { force: true });
  });

  test('deletes the orphaned artifact when reference minting fails', async () => {
    const { service } = makeDeps({ failMint: true });
    await assert.rejects(
      () =>
        service.generate(
          { organizationId: 'org-1', actorUserId: 'user-1', classroomId: 'room-1' },
          { accessToken: 'access-token' }
        ),
      (error: unknown) => error instanceof WindowsOfflineInstallerError
    );

    assert.equal(existsSync(artifactsDir) && readdirSyncLength(artifactsDir) > 0, false);
  });

  test('revokes a minted reference when publishing the artifact fails', async () => {
    const deps = makeDeps({ failPublish: true });
    await assert.rejects(
      () =>
        deps.service.generate(
          { organizationId: 'org-1', actorUserId: 'user-1', classroomId: 'room-1' },
          { accessToken: 'access-token' }
        ),
      (error: unknown) =>
        error instanceof WindowsOfflineInstallerError && error.code === 'ARTIFACT_PUBLISH_FAILED'
    );

    assert.equal(deps.invalidationCalls, 1);
    assert.equal(existsSync(artifactsDir) && readdirSyncLength(artifactsDir) > 0, false);
  });

  test('fails closed when OpenPath does not honor the requested TTL', async () => {
    const refs = {
      async mintReference() {
        throw new Error('unused');
      },
      async consumeAttempt() {},
      async markConsumed() {},
    };
    const service = createWindowsOfflineInstallerService({
      refs: refs as never,
      ticketClient: (async () => ({
        enrollmentToken: 't',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        classroomId: 'room-1',
        classroomName: 'x',
      })) as never,
      assertAccess: (async () => {}) as never,
      findClassroom: (async () => ({ id: 'room-1', name: 'x' })) as never,
    });

    await assert.rejects(
      () =>
        service.generate(
          { organizationId: 'org-1', actorUserId: 'user-1', classroomId: 'room-1' },
          { accessToken: 'access-token' }
        ),
      (error: unknown) =>
        error instanceof WindowsOfflineInstallerError && error.code === 'UPSTREAM_TTL'
    );
  });

  test('fails closed on missing upstream authorization', async () => {
    const { service } = makeDeps();
    await assert.rejects(
      () =>
        service.generate(
          { organizationId: 'org-1', actorUserId: 'user-1', classroomId: 'room-1' },
          { accessToken: null }
        ),
      (error: unknown) =>
        error instanceof WindowsOfflineInstallerError && error.code === 'UNAUTHORIZED'
    );
  });
});

function readdirSyncLength(dir: string): number {
  return readdirSync(dir).length;
}
