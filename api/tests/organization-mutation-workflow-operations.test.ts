import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getOrCreateOrganizationMutationOperation } from '../src/lib/organization-mutation-workflow/operations.js';

void describe('organization-mutation-workflow/operations', () => {
  void test('exposes the durable ledger adapter entrypoint', () => {
    assert.equal(typeof getOrCreateOrganizationMutationOperation, 'function');
  });
});
