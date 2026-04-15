import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { cloneGroupIntoOrganization } from '../src/services/group-clone.service.js';

void describe('group-clone.service', () => {
  void test('exports the group clone use-case', () => {
    assert.equal(typeof cloneGroupIntoOrganization, 'function');
  });
});
