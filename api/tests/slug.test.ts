import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSlug } from '../src/openpath/slug.js';

void describe('openpath slug adapter', () => {
  void test('re-exports slug sanitization through the local boundary', () => {
    assert.equal(sanitizeSlug('Centro Público 01'), 'centro-publico-01');
  });
});
