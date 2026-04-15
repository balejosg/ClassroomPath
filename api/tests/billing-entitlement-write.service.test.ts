import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  upsertOrganizationEntitlement,
} from '../src/services/billing/billing-entitlement-write.service.js';

describe('billing-entitlement-write.service', () => {
  test('exports the entitlement write helpers', () => {
    assert.equal(typeof upsertOrganizationEntitlement, 'function');
    assert.equal(typeof activateExistingOrganizationEntitlement, 'function');
    assert.equal(typeof createOrganizationWithEntitlement, 'function');
  });
});
