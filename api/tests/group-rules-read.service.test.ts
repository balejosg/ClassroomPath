import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listGroupedGroupRules,
  listGroupRules,
  listPaginatedGroupRules,
} from '../src/services/group-rules-read.service.js';

void describe('group-rules-read.service', () => {
  void test('exports the group rule read use-cases', () => {
    assert.equal(typeof listGroupRules, 'function');
    assert.equal(typeof listPaginatedGroupRules, 'function');
    assert.equal(typeof listGroupedGroupRules, 'function');
  });
});
