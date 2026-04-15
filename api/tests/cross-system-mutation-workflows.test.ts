import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrganizationMutationRetryHandler,
  organizationMutationRetryHandlers,
} from '../src/services/cross-system-mutation-workflows.js';

void describe('cross-system-mutation-workflows', () => {
  void test('registers retry handlers for supported organization mutation types', () => {
    assert.equal(typeof organizationMutationRetryHandlers['users.assign_role'], 'function');
    assert.equal(typeof organizationMutationRetryHandlers['groups.create_group'], 'function');
    assert.equal(
      typeof organizationMutationRetryHandlers['classrooms.delete_classroom'],
      'function'
    );
  });

  void test('returns undefined for unsupported retry operations', () => {
    assert.equal(getOrganizationMutationRetryHandler('unsupported.operation'), undefined);
  });
});
