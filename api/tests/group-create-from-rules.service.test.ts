import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createOrganizationGroupFromRules } from '../src/services/group-create-from-rules.service.js';

void describe('group-create-from-rules.service', () => {
  void test('exports the rule-seeded group creation use-case', () => {
    assert.equal(typeof createOrganizationGroupFromRules, 'function');
  });
});
