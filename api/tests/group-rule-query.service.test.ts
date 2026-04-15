import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  listGroupRules,
  listPaginatedGroupRules,
  loadGroupRules,
} from '../src/services/group-rule-query.service.js';

void describe('group-rule-query.service', () => {
  void test('exports the rule loading and listing helpers', () => {
    assert.equal(typeof loadGroupRules, 'function');
    assert.equal(typeof listGroupRules, 'function');
    assert.equal(typeof listPaginatedGroupRules, 'function');
  });
});
