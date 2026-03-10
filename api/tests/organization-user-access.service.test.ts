import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertOrganizationUserAccess,
  getOrganizationUserIds,
  getRolesByUserId,
} from '../src/services/organization-user-access.service.js';

describe('organization-user-access.service', () => {
  it('exports the extracted organization access helpers', async () => {
    assert.equal(typeof getOrganizationUserIds, 'function');
    assert.equal(typeof assertOrganizationUserAccess, 'function');
    assert.equal(typeof getRolesByUserId, 'function');

    const roleMap = await getRolesByUserId([]);
    assert.deepStrictEqual([...roleMap.entries()], []);
  });
});
