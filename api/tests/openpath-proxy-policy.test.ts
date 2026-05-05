import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  OPENPATH_PROXY_MANIFEST,
  OPENPATH_PROXY_REWRITE_RULES,
  findBlockedOpenPathPassthroughPath,
  findBlockedOpenPathProcedureFromUrl,
  rewriteOpenPathProxyUrl,
} from '../src/lib/openpath-proxy-policy.js';

void describe('openpath-proxy-policy', () => {
  test('exports a single manifest for upstream exposure and blocking policy', () => {
    assert.deepStrictEqual(
      OPENPATH_PROXY_MANIFEST.proxyRoutes.map((route) => route.path),
      [
        '/health',
        '/api/config',
        '/api/extensions/firefox/openpath.xpi',
        '/api/extensions/chromium',
        '/api/enroll',
        '/api/requests/auto',
        '/api/requests/submit',
        '/api/agent/windows',
        '/api/agent/linux',
        '/api/machines/events',
        '/api/machines',
        '/w',
        '/trpc/healthReports.submit',
      ]
    );
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.notFoundRoutes, ['/v2', '/export']);
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.blockedPassthroughPrefixes, [
      '/api',
      '/w',
      '/api-docs',
    ]);
    assert.deepStrictEqual(OPENPATH_PROXY_MANIFEST.allowedTrpcProcedures, ['healthReports.submit']);
    assert.deepStrictEqual(
      OPENPATH_PROXY_REWRITE_RULES.map((rule) => rule.publicPath),
      [
        '/api/agent/windows/bootstrap/latest.json',
        '/api/agent/windows/latest.json',
        '/api/agent/linux/latest.json',
        '/api/agent/windows/bootstrap/file',
        '/api/agent/windows/file',
      ]
    );
  });

  test('rewrites public gateway aliases through the declarative compatibility map', () => {
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/windows/bootstrap/latest.json'),
      '/api/agent/windows/bootstrap/manifest'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/windows/latest.json'),
      '/api/agent/windows/manifest'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/linux/latest.json'),
      '/api/agent/linux/manifest'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl(
        '/api/agent/windows/bootstrap/file?path=runtime/browser-policy-spec.json'
      ),
      '/api/agent/windows/bootstrap/files/runtime/browser-policy-spec.json'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/windows/file?path=agents/windows/openpath-setup.exe'),
      '/api/agent/windows/files/agents/windows/openpath-setup.exe'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/windows/file?path=agents/windows/OpenPath Setup.exe'),
      '/api/agent/windows/files/agents/windows/OpenPath%20Setup.exe'
    );
    assert.strictEqual(
      rewriteOpenPathProxyUrl('/api/agent/windows/bootstrap/bundle.zip'),
      '/api/agent/windows/bootstrap/bundle.zip'
    );
  });

  test('returns null for non-/trpc URLs', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/cp/trpc/groups.list'), null);
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/api/health'), null);
  });

  test('returns the normalized blocked passthrough path while using the shared manifest', () => {
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/health'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/config?source=smoke'), null);
    assert.strictEqual(
      findBlockedOpenPathPassthroughPath('/api/extensions/firefox/openpath.xpi'),
      null
    );
    assert.strictEqual(
      findBlockedOpenPathPassthroughPath('/api/extensions/chromium/updates.xml'),
      null
    );
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/enroll/cls_123/ticket'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/requests/auto'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/requests/submit'), null);
    assert.strictEqual(
      findBlockedOpenPathPassthroughPath('/api/agent/windows/bootstrap/latest.json'),
      null
    );
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/agent/windows/latest.json'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/agent/windows/file'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/agent/linux/latest.json'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/agent/linux/package'), null);
    assert.strictEqual(
      findBlockedOpenPathPassthroughPath('/api/extensions/chromium/updates.xml'),
      null
    );
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/machines/register'), null);
    assert.strictEqual(
      findBlockedOpenPathPassthroughPath('/api/machines/pc-01/rotate-download-token'),
      null
    );
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/w/token-123/whitelist.txt'), null);
    assert.strictEqual(findBlockedOpenPathPassthroughPath('/api/users?page=1'), '/api/users');
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

  test('allows machine health report submission through the upstream proxy', () => {
    assert.strictEqual(findBlockedOpenPathProcedureFromUrl('/trpc/healthReports.submit'), null);
    assert.strictEqual(
      findBlockedOpenPathProcedureFromUrl('/trpc/healthReports.submit?batch=1'),
      null
    );
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
