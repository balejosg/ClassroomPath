import assert from 'node:assert';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import { normalizeGroupKey, scopedGroupNameForOrg } from '../src/services/group-name.service.js';

describe('group-name.service', () => {
  it('normalizes public names into stable lowercase slugs', () => {
    assert.strictEqual(normalizeGroupKey('  Grupo Ñ 123 / Aulas  '), 'grupo-123-aulas');
    assert.strictEqual(normalizeGroupKey('A___B   C'), 'ab-c');
  });

  it('creates deterministic opaque upstream names scoped by organization', () => {
    const first = scopedGroupNameForOrg('org_alpha', 'Shared Public Slug');
    const repeated = scopedGroupNameForOrg('org_alpha', '  shared   public slug ');
    const secondOrg = scopedGroupNameForOrg('org_beta', 'Shared Public Slug');

    assert.strictEqual(first, repeated);
    assert.notStrictEqual(first, secondOrg);
    assert.ok(first.startsWith('cpg-'));
    assert.ok(first.length <= 100);
    assert.ok(first.includes('-shared-public-slug-'));
  });

  it('rejects names without any usable letters or digits', () => {
    assert.throws(
      () => scopedGroupNameForOrg('org_alpha', '---___   !!!'),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        return true;
      }
    );
  });
});
