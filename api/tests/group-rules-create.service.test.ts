import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bulkCreateGroupRules,
  createOrReuseGroupRule,
} from '../src/services/group-rules-create.service.js';

void describe('group-rules-create.service', () => {
  void test('exports the group rule creation use-cases', () => {
    assert.equal(typeof createOrReuseGroupRule, 'function');
    assert.equal(typeof bulkCreateGroupRules, 'function');
  });
});
