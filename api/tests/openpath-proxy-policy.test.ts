import { test, describe } from 'node:test';
import assert from 'node:assert';
import { findBlockedOpenPathProcedureFromUrl } from '../src/lib/openpath-proxy-policy.js';

void describe('openpath-proxy-policy', () => {
  test('returns null for non-/trpc URLs', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/cp/trpc/groups.list'), null);
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/api/health'), null);
  });

  test('blocks exact matches', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/trpc/groups.list'), 'groups.list');
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/requests.create'),
      'requests.create'
    );
  });

  test('blocks prefix matches (router-level)', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/schedules.list'),
      'schedules.list'
    );
  });

  test('supports batched procedure paths', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/auth.me,requests.create?batch=1'),
      'requests.create'
    );
  });

  test('ignores query string', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/requests.list?batch=1'),
      'requests.list'
    );
  });
});
