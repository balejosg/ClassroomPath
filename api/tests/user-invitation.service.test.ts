import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createOrganizationUser,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
} from '../src/services/user-invitation.service.js';

describe('user-invitation.service', () => {
  test('exports the organization user invitation helpers', () => {
    assert.equal(typeof createOrganizationUser, 'function');
    assert.equal(typeof listOrganizationInvitations, 'function');
    assert.equal(typeof revokeOrganizationInvitation, 'function');
  });
});
