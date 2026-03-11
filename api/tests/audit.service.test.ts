import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { db } from '../src/db/index.js';
import {
  recordInvitationCreatedAuditEvent,
  recordPendingUserApprovedAuditEvent,
} from '../src/services/audit.service.js';

describe('audit.service', { concurrency: 1 }, () => {
  it('persists typed audit events with structured metadata', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const insertMock = mock.method(db, 'insert', () => ({
      values: async (row: Record<string, unknown>) => {
        writes.push(row);
      },
    }));

    try {
      await recordInvitationCreatedAuditEvent({
        organizationId: 'org_audit_test',
        actorUserId: 'admin_audit_test',
        invitationId: 'inv_audit_test',
        email: 'teacher@example.com',
        name: 'Teacher Invitee',
        role: 'teacher',
      });

      await recordPendingUserApprovedAuditEvent({
        organizationId: 'org_audit_test',
        actorUserId: 'admin_audit_test',
        userId: 'user_audit_test',
        membershipId: 'mem_audit_test',
        role: 'admin',
      });
    } finally {
      insertMock.mock.restore();
    }

    assert.strictEqual(writes.length, 2);

    assert.deepStrictEqual(
      writes.map((row) => ({
        organizationId: row.organizationId,
        actorUserId: row.actorUserId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
      })),
      [
        {
          organizationId: 'org_audit_test',
          actorUserId: 'admin_audit_test',
          action: 'invitation.created',
          targetType: 'invitation',
          targetId: 'inv_audit_test',
          metadata: {
            email: 'teacher@example.com',
            name: 'Teacher Invitee',
            role: 'teacher',
          },
        },
        {
          organizationId: 'org_audit_test',
          actorUserId: 'admin_audit_test',
          action: 'pending-user.approved',
          targetType: 'user',
          targetId: 'user_audit_test',
          metadata: {
            membershipId: 'mem_audit_test',
            role: 'admin',
          },
        },
      ]
    );

    for (const row of writes) {
      assert.match(String(row.id), /^audit_/);
    }
  });
});
