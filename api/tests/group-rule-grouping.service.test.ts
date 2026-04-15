import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { listGroupedGroupRules } from '../src/services/group-rule-grouping.service.js';

void describe('group-rule-grouping.service', () => {
  void test('exports the grouped rule listing helper', () => {
    assert.equal(typeof listGroupedGroupRules, 'function');
  });
});
