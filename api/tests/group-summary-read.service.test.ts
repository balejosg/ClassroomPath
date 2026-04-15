import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listOrganizationGroups,
  listOrganizationLibraryGroups,
} from '../src/services/group-summary-read.service.js';

void describe('group-summary-read.service', () => {
  void test('exports tenant group summary readers', () => {
    assert.equal(typeof listOrganizationGroups, 'function');
    assert.equal(typeof listOrganizationLibraryGroups, 'function');
  });
});
