import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSeededUpstreamGroup } from '../src/services/group-seeded-upstream-create.service.js';

void describe('group-seeded-upstream-create.service', () => {
  void test('exports the upstream seeded group creation helper', () => {
    assert.equal(typeof createSeededUpstreamGroup, 'function');
  });
});
