import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { commitPendingUserMembership } from '../src/services/pending-user-membership-commit.service.js';

void describe('pending-user-membership-commit.service', () => {
  void test('exports the transactional pending-user membership commit', () => {
    assert.equal(typeof commitPendingUserMembership, 'function');
  });
});
