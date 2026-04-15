import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteOrganizationUser } from '../src/services/organization-user-delete.service.js';

void describe('organization-user-delete.service', () => {
  void test('exports the organization user deletion use-case', () => {
    assert.equal(typeof deleteOrganizationUser, 'function');
  });
});
