import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  recordInvitationCreatedAuditEvent,
  recordInvitationRevokedAuditEvent,
} from '../src/services/audit-invitation.service.js';

void describe('audit-invitation.service', () => {
  void test('exports the invitation audit helpers', () => {
    assert.equal(typeof recordInvitationCreatedAuditEvent, 'function');
    assert.equal(typeof recordInvitationRevokedAuditEvent, 'function');
  });
});
