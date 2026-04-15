import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchRuleCountsForGroupIds,
  fetchTenantGroupsByIds,
  getTeacherVisibleGroupIds,
} from '../src/services/group-read-shared.service.js';

void describe('group-read-shared.service', () => {
  void test('exports shared tenant group readers', () => {
    assert.equal(typeof fetchRuleCountsForGroupIds, 'function');
    assert.equal(typeof fetchTenantGroupsByIds, 'function');
    assert.equal(typeof getTeacherVisibleGroupIds, 'function');
  });
});
