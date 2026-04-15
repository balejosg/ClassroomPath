import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createOrganizationGroup,
  createOrganizationGroupFromRules,
} from '../src/services/group-create.service.js';

void describe('group-create.service', () => {
  void test('exports the group creation use-cases', () => {
    assert.equal(typeof createOrganizationGroup, 'function');
    assert.equal(typeof createOrganizationGroupFromRules, 'function');
  });
});
