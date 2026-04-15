import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createPendingOrganizationInvitationRecord,
  deletePendingOrganizationInvitationRecord,
} from '../src/services/invitation-persist.service.js';

describe('invitation-persist.service', () => {
  test('exports the tenant invitation persistence helpers', () => {
    assert.equal(typeof createPendingOrganizationInvitationRecord, 'function');
    assert.equal(typeof deletePendingOrganizationInvitationRecord, 'function');
  });
});
