import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { acceptOrganizationInvitation } from '../src/services/invitation-accept.service.js';

void describe('invitation-accept.service', () => {
  void test('exports the invitation accept use-case', () => {
    assert.equal(typeof acceptOrganizationInvitation, 'function');
  });
});
