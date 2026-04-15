import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { presentAssignedOrganizationUserRole } from '../src/services/organization-user-role-assignment-presenter.service.js';

void describe('organization-user-role-assignment-presenter.service', () => {
  void test('exports the role-assignment presenter helper', () => {
    assert.equal(typeof presentAssignedOrganizationUserRole, 'function');
  });
});
