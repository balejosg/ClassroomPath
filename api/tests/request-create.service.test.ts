import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createTenantRequest } from '../src/services/request-create.service.js';

describe('request-create.service', () => {
  test('exports the tenant request create use-case', () => {
    assert.equal(typeof createTenantRequest, 'function');
  });
});
