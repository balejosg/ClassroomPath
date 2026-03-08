import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import { getGatewayReadiness } from '../src/server.js';
import type { Context } from '../src/trpc/context.js';
import { getGatewaySystemInfo, healthcheckRouter } from '../src/trpc/routers/healthcheck.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response
): void {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) =>
    await handler(input, init);
}

function createContext(): Context {
  return {
    user: null,
    token: null,
    req: { headers: {} } as never,
    res: {} as never,
    authFailure: null,
  };
}

function trpcResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: { data } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

describe('Healthcheck Router', () => {
  it('reports readiness when upstream and database checks succeed', async () => {
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ result: { data: { status: 'ready' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    assert.strictEqual(readiness.ready, true);
    assert.strictEqual(readiness.upstreamAvailable, true);
    assert.strictEqual(readiness.databaseConnected, true);
  });

  it('reports readiness failure when upstream check fails', async () => {
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => true,
      fetchImpl: async () => {
        throw new Error('upstream down');
      },
    });

    assert.strictEqual(readiness.ready, false);
    assert.strictEqual(readiness.upstreamAvailable, false);
    assert.strictEqual(readiness.databaseConnected, true);
  });

  it('reports readiness failure when database check fails', async () => {
    const readiness = await getGatewayReadiness({
      checkDatabase: async () => false,
      fetchImpl: async () =>
        new Response(JSON.stringify({ result: { data: { status: 'ready' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    assert.strictEqual(readiness.ready, false);
    assert.strictEqual(readiness.upstreamAvailable, true);
    assert.strictEqual(readiness.databaseConnected, false);
  });

  it('marks system info as degraded when upstream is unavailable', async () => {
    const systemInfo = await getGatewaySystemInfo(async () => {
      throw new Error('upstream unavailable');
    });

    assert.strictEqual(systemInfo.degraded, true);
    assert.strictEqual(systemInfo.upstreamAvailable, false);
    assert.strictEqual(systemInfo.databaseConnected, false);
  });

  it('returns healthy system info when upstream database is connected', async () => {
    const systemInfo = await getGatewaySystemInfo(async () =>
      trpcResponse({
        version: '1.2.3',
        database: {
          connected: true,
          type: 'postgresql',
        },
        session: {
          accessTokenExpiry: '24h',
          accessTokenExpiryHuman: '24 hours',
          refreshTokenExpiry: '7d',
          refreshTokenExpiryHuman: '7 days',
        },
        backup: {
          lastBackupAt: null,
          lastBackupHuman: null,
          lastBackupStatus: null,
        },
        uptime: 42,
      })
    );

    assert.strictEqual(systemInfo.degraded, false);
    assert.strictEqual(systemInfo.upstreamAvailable, true);
    assert.strictEqual(systemInfo.databaseConnected, true);
    assert.strictEqual(systemInfo.version, '1.2.3');
  });

  it('marks system info as degraded when upstream database is disconnected', async () => {
    const systemInfo = await getGatewaySystemInfo(async () =>
      trpcResponse({
        version: '1.2.3',
        database: {
          connected: false,
          type: 'postgresql',
        },
        session: {
          accessTokenExpiry: '24h',
          accessTokenExpiryHuman: '24 hours',
          refreshTokenExpiry: '7d',
          refreshTokenExpiryHuman: '7 days',
        },
        backup: {
          lastBackupAt: null,
          lastBackupHuman: null,
          lastBackupStatus: null,
        },
        uptime: 42,
      })
    );

    assert.strictEqual(systemInfo.degraded, true);
    assert.strictEqual(systemInfo.upstreamAvailable, true);
    assert.strictEqual(systemInfo.databaseConnected, false);
  });

  it('forwards liveness checks to the upstream router', async () => {
    let seenMethod = '';
    let seenUrl = '';

    mockFetch(async (input, init) => {
      seenMethod = String(init?.method ?? 'GET');
      seenUrl = String(input);
      return trpcResponse({ status: 'ok' });
    });

    const result = await healthcheckRouter.createCaller(createContext()).live();

    assert.strictEqual(seenMethod, 'GET');
    assert.match(seenUrl, /\/trpc\/healthcheck\.live$/);
    assert.deepStrictEqual(result, { status: 'ok' });
  });

  it('fails liveness checks closed when the upstream returns a bad status', async () => {
    mockFetch(async () => new Response('upstream error', { status: 503 }));

    await expectTrpcError(
      healthcheckRouter.createCaller(createContext()).live(),
      'INTERNAL_SERVER_ERROR',
      /unavailable/i
    );
  });

  it('forwards readiness checks to the upstream router', async () => {
    const result = await (async () => {
      mockFetch(async () => trpcResponse({ status: 'ready' }));
      return await healthcheckRouter.createCaller(createContext()).ready();
    })();

    assert.deepStrictEqual(result, { status: 'ready' });
  });

  it('fails readiness checks closed when the upstream cannot be reached', async () => {
    mockFetch(async () => {
      throw new Error('upstream down');
    });

    await expectTrpcError(
      healthcheckRouter.createCaller(createContext()).ready(),
      'INTERNAL_SERVER_ERROR',
      /unavailable/i
    );
  });
});
