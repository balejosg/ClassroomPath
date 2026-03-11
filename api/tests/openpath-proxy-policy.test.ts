import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  OPENPATH_PROXY_MANIFEST,
  findBlockedOpenPathPassthroughPath,
  findBlockedOpenPathProcedureFromUrl,
} from '../src/lib/openpath-proxy-policy.js';

void describe('openpath-proxy-policy', () => {
  test('exports a single manifest for upstream exposure and blocking policy', () => {
    assert.deepStrictEqual(
      OPENPATH_PROXY_MANIFEST.proxyRoutes.map((route) => route.path),
      ['/health', '/api/machines/events']
    );
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.notFoundRoutes, ['/v2', '/export']);
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.blockedPassthroughPrefixes, [
      '/api',
      '/w',
      '/api-docs',
    ]);
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.allowedTrpcProcedures, []);
  });

  test('returns null for non-/trpc URLs', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/cp/trpc/groups.list'), null);
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/api/health'), null);
  });

  test('returns the normalized blocked passthrough path while using the shared manifest', () => {
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/health'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/users?page=1'), '/api/users');
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/w/agent/install'), '/w/agent/install');
  });

  test('blocks exact matches', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/trpc/groups.list'), 'groups.list');
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/requests.create'),
      'requests.create'
    );
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/setup.getRegistrationToken'),
      'setup.getRegistrationToken'
    );
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/auth.generateResetToken'),
      'auth.generateResetToken'
    );
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/healthReports.list'),
      'healthReports.list'
    );
  });

  test('blocks any direct upstream tRPC passthrough that is not explicitly approved', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/schedules.list'),
      'schedules.list'
    );
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/trpc/auth.me'), 'auth.me');
  });

  test('supports batched procedure paths', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/auth.me,requests.create?batch=1'),
      'auth.me'
    );
  });

  test('ignores query string', () => {
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/requests.list?batch=1'),
      'requests.list'
    );
  });
});
