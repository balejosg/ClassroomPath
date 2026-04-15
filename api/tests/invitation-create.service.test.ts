import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createOrganizationInvitation } from '../src/services/invitation-create.service.js';

void describe('invitation-create.service', () => {
  void test('exports the invitation create use-case', () => {
    assert.equal(typeof createOrganizationInvitation, 'function');
  });
});
