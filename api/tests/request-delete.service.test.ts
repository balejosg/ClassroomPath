import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { deleteTenantRequest } from '../src/services/request-delete.service.js';

describe('request-delete.service', () => {
  test('exports the tenant request delete use-case', () => {
    assert.equal(typeof deleteTenantRequest, 'function');
  });
});
