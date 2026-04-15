import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { updateOrganizationGroup } from '../src/services/group-update.service.js';

void describe('group-update.service', () => {
  void test('exports the group update use-case', () => {
    assert.equal(typeof updateOrganizationGroup, 'function');
  });
});
