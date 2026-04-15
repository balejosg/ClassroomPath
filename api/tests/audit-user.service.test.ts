import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  recordPendingUserApprovedAuditEvent,
  recordPendingUserRejectedAuditEvent,
  recordResetTokenGeneratedAuditEvent,
  recordUserDeletedAuditEvent,
  recordUserRoleAssignedAuditEvent,
  recordUserRoleRevokedAuditEvent,
} from '../src/services/audit-user.service.js';

void describe('audit-user.service', () => {
  void test('exports the user audit helpers', () => {
    assert.equal(typeof recordResetTokenGeneratedAuditEvent, 'function');
    assert.equal(typeof recordPendingUserApprovedAuditEvent, 'function');
    assert.equal(typeof recordPendingUserRejectedAuditEvent, 'function');
    assert.equal(typeof recordUserDeletedAuditEvent, 'function');
    assert.equal(typeof recordUserRoleAssignedAuditEvent, 'function');
    assert.equal(typeof recordUserRoleRevokedAuditEvent, 'function');
  });
});
