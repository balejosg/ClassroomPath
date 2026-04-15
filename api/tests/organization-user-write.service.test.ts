import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignOrganizationUserRole,
  deleteOrganizationUser,
  revokeOrganizationUserRole,
} from '../src/services/organization-user-write.service.js';

void describe('organization-user-write.service', () => {
  void test('exports the write use-cases behind the stable user-service facade', () => {
    assert.equal(typeof assignOrganizationUserRole, 'function');
    assert.equal(typeof revokeOrganizationUserRole, 'function');
    assert.equal(typeof deleteOrganizationUser, 'function');
  });
});
