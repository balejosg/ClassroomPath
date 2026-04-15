import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeWhitelistRule } from '../src/services/group-rule-serialization.service.js';

void describe('group-rule-serialization.service', () => {
  void test('exports the whitelist rule serializer', () => {
    assert.equal(typeof serializeWhitelistRule, 'function');
  });
});
