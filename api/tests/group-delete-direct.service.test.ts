import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteOrganizationGroup } from '../src/services/group-delete-direct.service.js';

void describe('group-delete-direct.service', () => {
  void test('exports the direct group deletion use-case', () => {
    assert.equal(typeof deleteOrganizationGroup, 'function');
  });
});
