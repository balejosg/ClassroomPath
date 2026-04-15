import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { rejectTenantRequest } from '../src/services/request-reject.service.js';

describe('request-reject.service', () => {
  test('exports the tenant request reject use-case', () => {
    assert.equal(typeof rejectTenantRequest, 'function');
  });
});
