import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { linkOrganizationGroup } from '../src/services/group-local-link.service.js';

void describe('group-local-link.service', () => {
  void test('exports the organization group linking helper', () => {
    assert.equal(typeof linkOrganizationGroup, 'function');
  });
});
