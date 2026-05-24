import assert from 'node:assert';
import { describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import {
  createOpenPathGateway,
  getOpenPathGatewaySystemInfo,
} from '../src/lib/openpath/gateway.js';

function trpcResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: { data } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function expectTrpcError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedMessage: RegExp
): Promise<void> {
  try {
    await promise;
    assert.fail('expected tRPC error');
  } catch (error) {
    assert.ok(error instanceof TRPCError);
    assert.strictEqual(error.code, expectedCode);
    assert.match(error.message, expectedMessage);
  }
}

describe('OpenPathGateway', () => {
  it('forwards health checks with normalized tRPC response payloads', async () => {
    let seenMethod = '';
    let seenUrl = '';

    const gateway = createOpenPathGateway({
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenMethod = String(init?.method ?? 'GET');
        return trpcResponse({ status: 'ok' });
      },
    });

    const result = await gateway.healthLive();

    assert.strictEqual(seenMethod, 'GET');
    assert.match(seenUrl, /\/trpc\/healthcheck\.live$/);
    assert.deepStrictEqual(result, { status: 'ok' });
  });

  it('uses bearer auth and forwarded IP headers for API token requests', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenBody = '';

    const gateway = createOpenPathGateway({
      fetchImpl: async (_input, init) => {
        seenHeaders = init?.headers as Record<string, string>;
        seenBody = String(init?.body ?? '');
        return trpcResponse({ id: 'tok_1', token: 'secret' });
      },
    });

    const result = await gateway.createApiToken({
      req: { headers: { 'x-forwarded-for': ['203.0.113.1', '198.51.100.2'] } },
      token: 'access-token',
      input: { name: 'CLI token', expiresInDays: 30 },
    });

    assert.strictEqual(seenHeaders.Authorization, 'Bearer access-token');
    assert.strictEqual(seenHeaders['X-Forwarded-For'], '203.0.113.1, 198.51.100.2');
    assert.deepStrictEqual(JSON.parse(seenBody), { name: 'CLI token', expiresInDays: 30 });
    assert.deepStrictEqual(result, { id: 'tok_1', token: 'secret' });
  });

  it('preserves upstream auth errors for API token listing', async () => {
    const gateway = createOpenPathGateway({
      fetchImpl: async () => errorResponse(401, 'Not authenticated'),
    });

    await expectTrpcError(
      gateway.listApiTokens({
        req: { headers: {} },
        token: 'expired-token',
      }),
      'UNAUTHORIZED',
      /not authenticated/i
    );
  });

  it('fails closed when API token listing returns malformed data', async () => {
    const gateway = createOpenPathGateway({
      fetchImpl: async () => trpcResponse({ unexpected: true }),
    });

    await expectTrpcError(
      gateway.listApiTokens({
        req: { headers: {} },
        token: 'access-token',
      }),
      'SERVICE_UNAVAILABLE',
      /unavailable/i
    );
  });

  it('maps system info failures to the existing degraded fallback', async () => {
    const systemInfo = await getOpenPathGatewaySystemInfo(
      createOpenPathGateway({
        fetchImpl: async () => {
          throw new Error('network down');
        },
      })
    );

    assert.strictEqual(systemInfo.degraded, true);
    assert.strictEqual(systemInfo.upstreamAvailable, false);
    assert.strictEqual(systemInfo.databaseConnected, false);
    assert.strictEqual(systemInfo.version, 'N/A');
  });
});
