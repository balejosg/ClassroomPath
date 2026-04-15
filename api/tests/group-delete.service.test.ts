import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bulkDeleteOrganizationGroupRules,
  deleteOrganizationGroup,
} from '../src/services/group-delete.service.js';

void describe('group-delete.service', () => {
  void test('exports the group deletion use-cases', () => {
    assert.equal(typeof deleteOrganizationGroup, 'function');
    assert.equal(typeof bulkDeleteOrganizationGroupRules, 'function');
  });
});
