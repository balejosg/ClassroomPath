import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeOrganizationGroupFromRulesParams } from '../src/services/group-create-from-rules-params.service.js';

describe('group-create-from-rules-params.service', () => {
  test('normalizes the tenant-scoped group creation input', () => {
    const normalized = normalizeOrganizationGroupFromRulesParams({
      organizationId: 'org_123',
      actorUserId: 'user_123',
      publicName: '  My First Group  ',
      displayName: 'My First Group',
      enabled: true,
      rules: [],
    });

    assert.equal(normalized.publicName, 'my-first-group');
    assert.match(normalized.name, /^cpg-[a-f0-9]{10}-my-first-group-[a-f0-9]{8}$/);
    assert.equal(normalized.visibility, 'private');
    assert.equal(normalized.enabled, 1);
  });

  test('rejects empty public names after normalization', () => {
    assert.throws(
      () =>
        normalizeOrganizationGroupFromRulesParams({
          organizationId: 'org_123',
          actorUserId: 'user_123',
          publicName: '   ',
          displayName: 'Broken Group',
          rules: [],
        }),
      /Group name is required/
    );
  });
});
