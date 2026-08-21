import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.DATABASE_URL ??= [
  'postgresql://',
  'openpath',
  ':',
  'openpath_dev',
  '@localhost:5432/classroompath_test',
].join('');
process.env.NODE_ENV = 'test';

const { db } = await import('../src/db/index.js');
const schema = await import('../src/db/schema.js');
const { eq } = await import('drizzle-orm');
const { createWindowsOfflineDownloadRefsService, DownloadReferenceError, hashDownloadReference } =
  await import('../src/services/windows-offline-installer-download-refs.service.js');

const ORG_ID = 'woi-refs-org';

async function ensureOrg(): Promise<void> {
  await db
    .insert(schema.cpOrganizations)
    .values({ id: ORG_ID, name: 'WOI Refs Org', createdBy: 'seed' })
    .onConflictDoNothing();
}

before(async () => {
  await ensureOrg();
});

after(async () => {
  await db
    .delete(schema.cpWindowsOfflineDownloadRefs)
    .where(eq(schema.cpWindowsOfflineDownloadRefs.organizationId, ORG_ID));
  await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
});

describe('windows-offline-installer download refs', () => {
  test('mints an opaque token, persists only its hash, and expires on schedule', async () => {
    const fixedNow = new Date('2026-08-21T12:00:00.000Z');
    const service = createWindowsOfflineDownloadRefsService({ now: () => fixedNow });

    const { ref, rawToken } = await service.mintReference({
      organizationId: ORG_ID,
      classroomId: 'room-1',
      classroomName: 'Room 1',
      createdBy: 'user-1',
      artifactSha256: 'a'.repeat(64),
      artifactSize: 1024,
      ttlMinutes: 10,
      maxAttempts: 3,
    });

    assert.equal(ref.referenceHash, hashDownloadReference(rawToken));
    assert.ok(!JSON.stringify(ref).includes(rawToken));
    assert.equal(ref.expiresAt.getTime(), Date.parse('2026-08-21T12:10:00.000Z'));
    assert.equal(ref.usedAttempts, 0);
    assert.equal(ref.maxAttempts, 3);
  });

  test('increments attempts per start and fails closed when exhausted', async () => {
    const service = createWindowsOfflineDownloadRefsService();
    const { rawToken } = await service.mintReference({
      organizationId: ORG_ID,
      classroomId: 'room-2',
      classroomName: 'Room 2',
      createdBy: 'user-1',
      artifactSha256: 'b'.repeat(64),
      artifactSize: 2048,
      ttlMinutes: 10,
      maxAttempts: 3,
    });

    assert.equal((await service.consumeAttempt(rawToken)).usedAttempts, 1);
    assert.equal((await service.consumeAttempt(rawToken)).usedAttempts, 2);
    assert.equal((await service.consumeAttempt(rawToken)).usedAttempts, 3);

    await assert.rejects(
      () => service.consumeAttempt(rawToken),
      (error: unknown) => error instanceof DownloadReferenceError && error.code === 'EXHAUSTED'
    );
  });

  test('rejects expired references before consuming an attempt', async () => {
    const expiredNow = new Date(Date.now() - 60_000);
    const service = createWindowsOfflineDownloadRefsService({ now: () => expiredNow });
    const { rawToken } = await service.mintReference({
      organizationId: ORG_ID,
      classroomId: 'room-3',
      classroomName: 'Room 3',
      createdBy: 'user-1',
      artifactSha256: 'c'.repeat(64),
      artifactSize: 4096,
      ttlMinutes: 1,
      maxAttempts: 3,
    });

    const liveService = createWindowsOfflineDownloadRefsService();
    await assert.rejects(
      () => liveService.consumeAttempt(rawToken),
      (error: unknown) => error instanceof DownloadReferenceError && error.code === 'EXPIRED'
    );
  });

  test('invalidates the reference after a completed download', async () => {
    const service = createWindowsOfflineDownloadRefsService();
    const { rawToken } = await service.mintReference({
      organizationId: ORG_ID,
      classroomId: 'room-4',
      classroomName: 'Room 4',
      createdBy: 'user-1',
      artifactSha256: 'd'.repeat(64),
      artifactSize: 8192,
      ttlMinutes: 10,
      maxAttempts: 3,
    });

    await service.consumeAttempt(rawToken);
    await service.markConsumed(rawToken);

    await assert.rejects(
      () => service.consumeAttempt(rawToken),
      (error: unknown) => error instanceof DownloadReferenceError && error.code === 'CONSUMED'
    );
  });

  test('rejects unknown references', async () => {
    const service = createWindowsOfflineDownloadRefsService();
    await assert.rejects(
      () => service.consumeAttempt('no-such-reference'),
      (error: unknown) => error instanceof DownloadReferenceError && error.code === 'INVALID'
    );
  });
});
