import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createWindowsOfflineInstallerDownloadHandler } =
  await import('../src/lib/windows-offline-installer-route.js');
const { DownloadReferenceError } =
  await import('../src/services/windows-offline-installer-download-refs.service.js');

const tempRoot = mkdtempSync(path.join(tmpdir(), 'cp-woi-route-'));
const ARTIFACT_BYTES = Buffer.from('OPWS-ARTIFACT-BYTES-0123456789', 'utf8');
const REF_HASH = 'a'.repeat(64);

function writeArtifact(): string {
  const dir = path.join(tempRoot, 'artifacts');
  mkdirSync(dir, { recursive: true });
  const artifactPath = path.join(dir, `${REF_HASH.slice(0, 32)}.exe`);
  if (!existsSync(artifactPath)) {
    writeFileSync(artifactPath, ARTIFACT_BYTES);
  }
  return artifactPath;
}

const REF_RECORD = {
  id: 'ref-1',
  organizationId: 'org-1',
  classroomId: 'room-1',
  classroomName: 'Math A',
  referenceHash: REF_HASH,
  artifactSha256: createHash('sha256').update(ARTIFACT_BYTES).digest('hex'),
  artifactSize: ARTIFACT_BYTES.length,
  maxAttempts: 3,
  usedAttempts: 0,
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
};

function makeDeps(
  options: { consumeError?: DownloadReferenceError; missingArtifact?: boolean } = {}
) {
  const calls = { consumeAttempt: 0, markConsumed: 0 };
  const deps = {
    refs: {
      async consumeAttempt(rawToken: string) {
        calls.consumeAttempt += 1;
        if (options.consumeError) throw options.consumeError;
        assert.equal(typeof rawToken, 'string');
        return REF_RECORD;
      },
      async markConsumed(rawToken: string) {
        calls.markConsumed += 1;
        void rawToken;
      },
    },
    resolveArtifactPath: () =>
      options.missingArtifact ? path.join(tempRoot, 'artifacts', 'missing.exe') : writeArtifact(),
  };
  return { deps, calls };
}

async function listen(
  app: import('express').Express
): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

let servers: Server[] = [];
const started = new Map<Server, string>();

after(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

async function startWithHandler(handler: import('express').RequestHandler): Promise<string> {
  const app = express();
  app.get('/cp/api/windows-offline-installer/download', handler);
  const { server, baseUrl } = await listen(app);
  servers.push(server);
  started.set(server, baseUrl);
  return baseUrl;
}

describe('windows offline installer download route', () => {
  test('rejects a missing reference parameter', async () => {
    const { deps } = makeDeps();
    const handler = createWindowsOfflineInstallerDownloadHandler(deps as never);
    const baseUrl = await startWithHandler(handler);

    const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download`);
    assert.equal(response.status, 400);
  });

  test('returns 404 for unknown references without touching artifacts', async () => {
    const { deps } = makeDeps({
      consumeError: new DownloadReferenceError('INVALID', 'Unknown download reference'),
    });
    const handler = createWindowsOfflineInstallerDownloadHandler(deps as never);
    const baseUrl = await startWithHandler(handler);

    const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download?ref=nope`);
    assert.equal(response.status, 404);
  });

  test('maps expired, exhausted, and consumed references to 410', async () => {
    for (const code of ['EXPIRED', 'EXHAUSTED', 'CONSUMED'] as const) {
      const { deps } = makeDeps({ consumeError: new DownloadReferenceError(code, code) });
      const handler = createWindowsOfflineInstallerDownloadHandler(deps as never);
      const baseUrl = await startWithHandler(handler);

      const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download?ref=x`);
      assert.equal(response.status, 410, code);
    }
  });

  test('streams the artifact byte-for-byte with attachment and no-store headers', async () => {
    const { deps, calls } = makeDeps();
    const handler = createWindowsOfflineInstallerDownloadHandler(deps as never);
    const baseUrl = await startWithHandler(handler);

    const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download?ref=tok`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /attachment; filename="OpenPath-Math-A-Windows-Setup\.exe"/
    );
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.equals(ARTIFACT_BYTES));

    assert.equal(calls.consumeAttempt, 1);

    for (let waited = 0; waited < 1000 && calls.markConsumed === 0; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(calls.markConsumed, 1);
  });

  test('consumes an attempt at connection start even when the artifact is missing', async () => {
    const { deps, calls } = makeDeps({ missingArtifact: true });
    const handler = createWindowsOfflineInstallerDownloadHandler(deps as never);
    const baseUrl = await startWithHandler(handler);

    const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download?ref=tok`);
    assert.equal(response.status, 404);
    assert.equal(calls.consumeAttempt, 1);
    assert.equal(calls.markConsumed, 0);
  });

  test('does not invalidate the reference when streaming fails', async () => {
    const { deps, calls } = makeDeps();
    const handler = createWindowsOfflineInstallerDownloadHandler({
      refs: (deps as { refs: unknown }).refs,
      // a directory cannot be streamed as a file; the read fails mid-response
      resolveArtifactPath: () => tempRoot,
    } as never);
    const baseUrl = await startWithHandler(handler as never);

    const response = await fetch(`${baseUrl}/cp/api/windows-offline-installer/download?ref=tok`);
    assert.notEqual(response.status, 200);
    assert.equal(calls.markConsumed, 0);
  });
});
