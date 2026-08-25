import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  getGatewayReadiness,
  isGatewayUpstreamReadyStatus,
  parseGatewayUpstreamReadiness,
} from '../src/lib/gateway-readiness.js';
import type { WindowsOfflineInstallerReadiness } from '../src/lib/windows-offline-installer-readiness.js';

function trpcResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: { data } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

await describe('gateway readiness helpers', async () => {
  await test('isGatewayUpstreamReadyStatus accepts ready and ok', () => {
    assert.strictEqual(isGatewayUpstreamReadyStatus('ready'), true);
    assert.strictEqual(isGatewayUpstreamReadyStatus('ok'), true);
    assert.strictEqual(isGatewayUpstreamReadyStatus('READY'), false);
    assert.strictEqual(isGatewayUpstreamReadyStatus('down'), false);
  });

  await test('parseGatewayUpstreamReadiness extracts status from trpc and raw payloads', () => {
    assert.strictEqual(
      parseGatewayUpstreamReadiness({ result: { data: { status: 'ready' } } }),
      true
    );
    assert.strictEqual(parseGatewayUpstreamReadiness({ status: 'ok' }), true);
    assert.strictEqual(
      parseGatewayUpstreamReadiness({ result: { data: { status: 'down' } } }),
      false
    );
    assert.strictEqual(parseGatewayUpstreamReadiness(null), false);
  });

  await test('getGatewayReadiness reports ready when db and upstream checks succeed', async () => {
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => true,
      fetchImpl: async () => trpcResponse({ status: 'ok' }),
      checkOfflineInstaller: () => ({ ready: true, code: 'OK' }),
    });

    assert.deepStrictEqual(readiness, {
      ready: true,
      upstreamAvailable: true,
      databaseConnected: true,
      databaseSchemaReady: true,
      missingTables: [],
      offlineInstallerReady: true,
      offlineInstallerCode: 'OK',
    });
  });

  await test('getGatewayReadiness reports not ready when required ClassroomPath tables are missing', async () => {
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => ({
        connected: true,
        schemaReady: false,
        missingTables: ['cp_terms_acceptance'],
      }),
      fetchImpl: async () => trpcResponse({ status: 'ready' }),
      checkOfflineInstaller: () => ({ ready: true, code: 'OK' }),
    });

    assert.deepStrictEqual(readiness, {
      ready: false,
      upstreamAvailable: true,
      databaseConnected: true,
      databaseSchemaReady: false,
      missingTables: ['cp_terms_acceptance'],
      offlineInstallerReady: true,
      offlineInstallerCode: 'OK',
    });
  });

  await test('reports not ready when the local offline installer is broken', async () => {
    const offlineInstaller: WindowsOfflineInstallerReadiness = {
      ready: false,
      code: 'TEMPLATE_MISSING',
    };
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => true,
      fetchImpl: async () => trpcResponse({ status: 'ok' }),
      checkOfflineInstaller: () => offlineInstaller,
    });

    assert.deepStrictEqual(readiness, {
      ready: false,
      upstreamAvailable: true,
      databaseConnected: true,
      databaseSchemaReady: true,
      missingTables: [],
      offlineInstallerReady: false,
      offlineInstallerCode: 'TEMPLATE_MISSING',
    });
  });
});
