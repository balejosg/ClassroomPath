import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bulkDeleteOrganizationGroupRules } from '../src/services/group-rule-bulk-delete.service.js';

void describe('group-rule-bulk-delete.service', () => {
  void test('exports the bulk group-rule deletion use-case', () => {
    assert.equal(typeof bulkDeleteOrganizationGroupRules, 'function');
  });
});
