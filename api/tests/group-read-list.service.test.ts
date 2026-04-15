import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrganizationGroupStats,
  getOrganizationSystemStatus,
  listOrganizationGroups,
  listOrganizationLibraryGroups,
} from '../src/services/group-read-list.service.js';

void describe('group-read-list.service', () => {
  void test('exports the tenant group list and stats readers', () => {
    assert.equal(typeof listOrganizationGroups, 'function');
    assert.equal(typeof listOrganizationLibraryGroups, 'function');
    assert.equal(typeof getOrganizationGroupStats, 'function');
    assert.equal(typeof getOrganizationSystemStatus, 'function');
  });
});
