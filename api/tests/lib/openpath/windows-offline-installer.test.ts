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
