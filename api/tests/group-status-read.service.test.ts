import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrganizationGroupStats,
  getOrganizationSystemStatus,
} from '../src/services/group-status-read.service.js';

void describe('group-status-read.service', () => {
  void test('exports tenant group status readers', () => {
    assert.equal(typeof getOrganizationGroupStats, 'function');
    assert.equal(typeof getOrganizationSystemStatus, 'function');
  });
});
