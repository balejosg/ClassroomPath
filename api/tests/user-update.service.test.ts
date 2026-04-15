import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { updateOrganizationUser } from '../src/services/user-update.service.js';

describe('user-update.service', () => {
  test('exports the organization user update helper', () => {
    assert.equal(typeof updateOrganizationUser, 'function');
  });
});
