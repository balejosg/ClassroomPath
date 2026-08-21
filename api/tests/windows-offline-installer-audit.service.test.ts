import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { db } from '../src/db/index.js';
import { recordWindowsOfflineInstallerGeneration } from '../src/services/windows-offline-installer-audit.service.js';

void describe('windows-offline-installer audit service', () => {
  it('persists generation metadata without token material or artifact bytes', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const insertMock = mock.method(db, 'insert', () => ({
      values: async (row: Record<string, unknown>) => {
        writes.push(row);
      },
    }));

    try {
      await recordWindowsOfflineInstallerGeneration({
        organizationId: 'org_audit_test',
        actorUserId: 'teacher_audit_test',
        classroomId: 'classroom_audit_test',
        templateVersion: '4.1.0',
        templateCommit: 'commit42',
        templateSha256: 'b'.repeat(64),
        artifactSha256: 'c'.repeat(64),
        artifactSize: 12_345,
        tokenExpiresAt: '2026-08-22T00:00:00.000Z',
      });
    } finally {
      insertMock.mock.restore();
    }

    assert.equal(writes.length, 1);
    const row = writes[0] as { action?: string; metadata?: Record<string, unknown> };
    assert.equal(row.action, 'windows_offline_installer.generate');
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes('enrollmentToken'));
    assert.ok(!serialized.includes('payload'));
    assert.equal(row.metadata?.templateSha256, 'b'.repeat(64));
    assert.equal(row.metadata?.artifactSize, 12_345);
  });
});
