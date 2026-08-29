import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import {
  generateClassroomPathWindowsOfflineInstaller,
  type WindowsOfflineInstallerIntegrationGateway,
} from '../src/services/windows-offline-installer-integration.service.js';

const metadata = {
  fileName: 'OpenPath-Aula-1-Windows-Setup.exe',
  version: '4.1.0',
  sha256: 'b'.repeat(64),
  tokenExpiresAt: '2026-08-28T10:00:00.000Z',
  downloadUrl: 'https://classroompath.example/api/windows-offline-installer/download?ref=opaque-B',
  downloadExpiresAt: '2026-08-28T08:10:00.000Z',
};

describe('ClassroomPath Windows offline installer integration', () => {
  it('enforces the tenant classroom policy before calling canonical OpenPath', async () => {
    const events: string[] = [];
    const gateway: WindowsOfflineInstallerIntegrationGateway = {
      generateWindowsOfflineInstaller: async () => {
        events.push('openpath');
        return metadata;
      },
    };

    await assert.rejects(
      generateClassroomPathWindowsOfflineInstaller(
        {
          organizationId: 'org-a',
          classroomId: 'classroom-7',
          token: 'teacher-access-token',
          req: { headers: {} },
        },
        {
          gateway,
          assertClassroomAccess: async () => {
            events.push('policy');
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Classroom not found or access denied',
            });
          },
        }
      ),
      (error: unknown) => error instanceof TRPCError && error.code === 'NOT_FOUND'
    );

    assert.deepEqual(events, ['policy']);
  });

  it('forwards the wrapper session to OpenPath and returns only canonical safe metadata', async () => {
    let received: unknown;
    const gateway: WindowsOfflineInstallerIntegrationGateway = {
      generateWindowsOfflineInstaller: async (params) => {
        received = params;
        return metadata;
      },
    };

    const result = await generateClassroomPathWindowsOfflineInstaller(
      {
        organizationId: 'org-a',
        classroomId: 'classroom-7',
        token: 'teacher-access-token',
        req: { headers: { 'x-forwarded-for': '203.0.113.7' } },
      },
      {
        gateway,
        assertClassroomAccess: async () => undefined,
      }
    );

    assert.deepEqual(received, {
      req: { headers: { 'x-forwarded-for': '203.0.113.7' } },
      token: 'teacher-access-token',
      input: { classroomId: 'classroom-7' },
    });
    assert.deepEqual(result, metadata);
    assert.equal('artifactPath' in result, false);
    assert.equal('reference' in result, false);
  });
});
