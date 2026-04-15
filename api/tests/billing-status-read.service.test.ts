import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertOrganizationEntitled,
  getOrganizationBillingStatus,
} from '../src/services/billing/billing-status-read.service.js';

void describe('billing-status-read.service', () => {
  void test('exports the billing status read helpers', () => {
    assert.equal(typeof getOrganizationBillingStatus, 'function');
    assert.equal(typeof assertOrganizationEntitled, 'function');
  });
});
