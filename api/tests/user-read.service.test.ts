import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  getOrganizationUserById,
  getOrganizationUserRole,
  listOrganizationUsers,
} from '../src/services/user-read.service.js';

describe('user-read.service', () => {
  test('exports the organization user read helpers', () => {
    assert.equal(typeof listOrganizationUsers, 'function');
    assert.equal(typeof getOrganizationUserById, 'function');
    assert.equal(typeof getOrganizationUserRole, 'function');
  });
});
