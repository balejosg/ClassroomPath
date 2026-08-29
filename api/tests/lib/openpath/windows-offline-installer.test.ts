import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import { createOpenPathGateway } from '../../../src/lib/openpath/gateway.js';

function trpcResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: { data } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const metadata = {
  fileName: 'OpenPath-Aula-1-Windows-Setup.exe',
  version: '4.1.0',
  sha256: 'a'.repeat(64),
  tokenExpiresAt: '2026-08-28T10:00:00.000Z',
  downloadUrl: 'https://classroompath.example/api/windows-offline-installer/download?ref=opaque-A',
  downloadExpiresAt: '2026-08-28T08:10:00.000Z',
};

describe('OpenPathGateway Windows offline installer adapter', () => {
  it('calls only the public generate contract with the bearer session and classroom id', async () => {
    let seenUrl = '';
    let seenMethod = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody = '';

    const gateway = createOpenPathGateway({
      publicOrigin: 'https://classroompath.example',
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenMethod = String(init?.method);
        seenHeaders = init?.headers as Record<string, string>;
        seenBody = String(init?.body);
        return trpcResponse(metadata);
      },
    });

    const result = await gateway.generateWindowsOfflineInstaller({
      req: { headers: { 'x-forwarded-for': '203.0.113.7' } },
      token: 'teacher-access-token',
      input: { classroomId: 'classroom-7' },
    });

    assert.match(seenUrl, /\/trpc\/windowsOfflineInstaller\.generate$/);
    assert.equal(seenMethod, 'POST');
    assert.equal(seenHeaders.Authorization, 'Bearer teacher-access-token');
    assert.equal(seenHeaders['X-Forwarded-For'], '203.0.113.7');
    assert.deepEqual(JSON.parse(seenBody), { classroomId: 'classroom-7' });
    assert.deepEqual(result, metadata);
  });

  it('rebuilds attacker-controlled upstream origins as the ClassroomPath same-origin URL', async () => {
    const opaqueRef = 'opaque-A_123-xyz';
    const upstreamOrigins = [
      'https://attacker.example/api/windows-offline-installer/download?ref=opaque-A_123-xyz',
      'http://api:3000/api/windows-offline-installer/download?ref=opaque-A_123-xyz',
    ];

    for (const downloadUrl of upstreamOrigins) {
      const gateway = createOpenPathGateway({
        publicOrigin: 'https://classroompath.example',
        fetchImpl: async () => trpcResponse({ ...metadata, downloadUrl }),
      });

      const result = await gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      });
      const publicDownloadUrl = new URL(result.downloadUrl);

      assert.equal(publicDownloadUrl.origin, 'https://classroompath.example');
      assert.equal(publicDownloadUrl.pathname, '/api/windows-offline-installer/download');
      assert.deepEqual([...publicDownloadUrl.searchParams.keys()], ['ref']);
      assert.equal(publicDownloadUrl.searchParams.get('ref'), opaqueRef);
      assert.equal(result.downloadUrl.includes('attacker.example'), false);
      assert.equal(result.downloadUrl.includes('api:3000'), false);
    }
  });

  it('preserves the opaque ref through URL query serialization', async () => {
    const opaqueRef = 'opaque/ref + value?';
    const upstreamUrl = new URL('https://api:3000/api/windows-offline-installer/download');
    upstreamUrl.searchParams.set('ref', opaqueRef);
    const gateway = createOpenPathGateway({
      publicOrigin: 'https://classroompath.example',
      fetchImpl: async () => trpcResponse({ ...metadata, downloadUrl: upstreamUrl.toString() }),
    });

    const result = await gateway.generateWindowsOfflineInstaller({
      token: 'teacher-access-token',
      input: { classroomId: 'classroom-7' },
    });
    const publicDownloadUrl = new URL(result.downloadUrl);

    assert.deepEqual([...publicDownloadUrl.searchParams.keys()], ['ref']);
    assert.equal(publicDownloadUrl.searchParams.get('ref'), opaqueRef);
    assert.equal(publicDownloadUrl.origin, 'https://classroompath.example');
  });

  it('resolves the public origin when generation starts instead of capturing import-time env', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPublicUrl = process.env.PUBLIC_URL;
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_URL = 'https://before.example';

    try {
      const gateway = createOpenPathGateway({
        fetchImpl: async () => trpcResponse(metadata),
      });
      process.env.PUBLIC_URL = 'https://after.example';

      const result = await gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      });

      assert.equal(new URL(result.downloadUrl).origin, 'https://after.example');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = originalPublicUrl;
    }
  });

  it('rejects malformed upstream metadata without returning a ref or accepting a generic payload', async () => {
    const gateway = createOpenPathGateway({
      fetchImpl: async () => trpcResponse({ ...metadata, sha256: 'not-a-sha' }),
    });

    await assert.rejects(
      gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'OpenPath returned invalid offline installer metadata'
    );
  });

  it('rejects a URL outside the canonical download route', async () => {
    const gateway = createOpenPathGateway({
      fetchImpl: async () =>
        trpcResponse({
          ...metadata,
          downloadUrl: 'https://classroompath.example/api/other-download?ref=opaque-A',
        }),
    });

    await assert.rejects(
      gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'OpenPath returned invalid offline installer metadata'
    );
  });

  it('rejects credentials, fragments, missing refs, extra parameters, and unexpected metadata', async () => {
    const invalidDownloads = [
      'https://user:password@classroompath.example/api/windows-offline-installer/download?ref=opaque-A',
      'https://@classroompath.example/api/windows-offline-installer/download?ref=opaque-A',
      'https://classroompath.example/api/windows-offline-installer/download?ref=opaque-A#fragment',
      'https://classroompath.example/api/windows-offline-installer/download?ref=opaque-A#',
      'https://classroompath.example/api/windows-offline-installer/download',
      'https://classroompath.example/api/windows-offline-installer/download?ref=opaque-A&extra=1',
    ];

    for (const downloadUrl of invalidDownloads) {
      const gateway = createOpenPathGateway({
        publicOrigin: 'https://classroompath.example',
        fetchImpl: async () => trpcResponse({ ...metadata, downloadUrl }),
      });

      await assert.rejects(
        gateway.generateWindowsOfflineInstaller({
          token: 'teacher-access-token',
          input: { classroomId: 'classroom-7' },
        }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'INTERNAL_SERVER_ERROR' &&
          error.message === 'OpenPath returned invalid offline installer metadata'
      );
    }

    const gateway = createOpenPathGateway({
      publicOrigin: 'https://classroompath.example',
      fetchImpl: async () => trpcResponse({ ...metadata, unexpected: 'value' }),
    });

    await assert.rejects(
      gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'OpenPath returned invalid offline installer metadata'
    );
  });

  it('maps OpenPath authorization failures to safe wrapper-facing messages', async () => {
    const gateway = createOpenPathGateway({
      fetchImpl: async () => errorResponse(403, 'internal classroom authorization detail'),
    });

    await assert.rejects(
      gateway.generateWindowsOfflineInstaller({
        token: 'teacher-access-token',
        input: { classroomId: 'classroom-7' },
      }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'FORBIDDEN' &&
        error.message === 'Classroom access denied'
    );
  });
});
