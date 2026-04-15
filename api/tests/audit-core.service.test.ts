import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { db } from '../src/db/index.js';
import { logger } from '../src/lib/logger.js';
import {
  deleteAuditEventById,
  deleteAuditEventByIdBestEffort,
} from '../src/services/audit-core.service.js';

describe('audit-core.service', { concurrency: 1 }, () => {
  it('deletes audit events by id', async () => {
    let deletedId: string | undefined;
    const deleteMock = mock.method(db, 'delete', () => ({
      where: async (_predicate: unknown) => {
        deletedId = 'audit_delete_test';
      },
    }));

    try {
      await deleteAuditEventById('audit_delete_test');
    } finally {
      deleteMock.mock.restore();
    }

    assert.strictEqual(deletedId, 'audit_delete_test');
  });

  it('logs and swallows rollback delete failures', async () => {
    const deleteMock = mock.method(db, 'delete', () => ({
      where: async () => {
        throw Object.assign(new Error('boom'), { code: '23503' });
      },
    }));
    const warnMock = mock.method(logger, 'warn', () => undefined);

    try {
      await deleteAuditEventByIdBestEffort({
        auditEventId: 'audit_best_effort_test',
        action: 'invitation.created',
        targetId: 'target_best_effort_test',
      });
    } finally {
      deleteMock.mock.restore();
      warnMock.mock.restore();
    }

    assert.strictEqual(warnMock.mock.calls.length, 1);
  });
});
