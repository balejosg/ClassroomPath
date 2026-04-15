import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertOrganizationEntitled,
  getOrganizationBillingStatus,
} from '../src/services/billing/billing-manual.js';

void describe('billing-manual', () => {
  void test('returns an inactive billing status when no entitlement exists', async () => {
    const status = await getOrganizationBillingStatus('org_missing_billing');

    assert.equal(status.hasActiveEntitlement, false);
    assert.equal(status.status, null);
    assert.equal(status.classroomLimit, null);
  });

  void test('rejects entitlement checks when the organization has no active billing', async () => {
    await assert.rejects(
      () => assertOrganizationEntitled('org_missing_billing'),
      /Active billing required/
    );
  });
});
