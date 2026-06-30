import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeWhitelistRule } from '../src/services/group-rule-serialization.service.js';

void describe('group-rule-serialization.service', () => {
  void test('exports the whitelist rule serializer', () => {
    assert.equal(typeof serializeWhitelistRule, 'function');
  });

  void test('serializeWhitelistRule preserves allowed_path type', () => {
    const out = serializeWhitelistRule({
      id: 'r1',
      groupId: 'g1',
      type: 'allowed_path',
      value: 'youtube.com/watch?v=abc',
      comment: null,
      createdAt: null,
    } as never);
    assert.equal(out.type, 'allowed_path');
  });
});
