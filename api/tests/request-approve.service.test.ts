import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { approveTenantRequest } from '../src/services/request-approve.service.js';

describe('request-approve.service', () => {
  test('exports the tenant request approve use-case', () => {
    assert.equal(typeof approveTenantRequest, 'function');
  });
});
