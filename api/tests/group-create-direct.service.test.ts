import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createOrganizationGroup } from '../src/services/group-create-direct.service.js';

void describe('group-create-direct.service', () => {
  void test('exports the direct group creation use-case', () => {
    assert.equal(typeof createOrganizationGroup, 'function');
  });
});
