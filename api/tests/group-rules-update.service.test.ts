import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteGroupRule, updateGroupRule } from '../src/services/group-rules-update.service.js';

void describe('group-rules-update.service', () => {
  void test('exports the group rule mutation use-cases', () => {
    assert.equal(typeof updateGroupRule, 'function');
    assert.equal(typeof deleteGroupRule, 'function');
  });
});
