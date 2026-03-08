import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  getGatewayReadiness,
  isGatewayUpstreamReadyStatus,
  parseGatewayUpstreamReadiness,
} from '../src/lib/gateway-readiness.js';

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
    });

    assert.deepStrictEqual(readiness, {
      ready: true,
      upstreamAvailable: true,
      databaseConnected: true,
    });
  });
});
