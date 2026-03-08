import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';

import type { Context } from '../src/trpc/context.js';
import { apiTokensRouter } from '../src/trpc/routers/api-tokens.js';

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
        data: {
          code: 'UPSTREAM_ERROR',
        },
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    user: {
      sub: 'api-token-user',
      email: 'api-token@test.local',
      name: 'API Token User',
      roles: [{ role: 'admin', groupIds: [] }],
    },
    token: 'access-token',
    req: { headers: {} } as never,
    res: {} as never,
    authFailure: null,
    ...overrides,
  };
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

describe('apiTokensRouter', () => {
  it('lists tokens and forwards bearer auth to OpenPath', async () => {
    let seenUrl = '';
    let seenAuthorization = '';

    mockFetch(async (input, init) => {
      seenUrl = String(input);
      seenAuthorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization
      );

      return trpcResponse([
        {
          id: 'tok_1',
          name: 'Primary token',
          maskedToken: 'tok_****',
          lastUsedAt: null,
          expiresAt: null,
          createdAt: null,
          isExpired: false,
        },
      ]);
    });

    const tokens = await apiTokensRouter.createCaller(createContext()).list();

    assert.match(seenUrl, /\/trpc\/apiTokens\.list$/);
    assert.strictEqual(seenAuthorization, 'Bearer access-token');
    assert.deepStrictEqual(tokens, [
      {
        id: 'tok_1',
        name: 'Primary token',
        maskedToken: 'tok_****',
        lastUsedAt: null,
        expiresAt: null,
        createdAt: null,
        isExpired: false,
      },
    ]);
  });

  it('preserves unauthorized responses for token listing', async () => {
    mockFetch(async () => errorResponse(401, 'Not authenticated'));

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).list(),
      'UNAUTHORIZED',
      /not authenticated/i
    );
  });

  it('preserves forbidden responses for token listing', async () => {
    mockFetch(async () => errorResponse(403, 'Forbidden'));

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).list(),
      'FORBIDDEN',
      /forbidden/i
    );
  });

  it('fails closed when token listing returns malformed data', async () => {
    mockFetch(async () => trpcResponse({ unexpected: true }));

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).list(),
      'SERVICE_UNAVAILABLE',
      /unavailable/i
    );
  });

  it('creates tokens and forwards the serialized request body', async () => {
    let seenBody = '';

    mockFetch(async (_input, init) => {
      seenBody = String(init?.body ?? '');
      return trpcResponse({
        id: 'tok_2',
        name: 'CLI token',
        token: 'tok_secret',
      });
    });

    const result = await apiTokensRouter.createCaller(createContext()).create({
      name: 'CLI token',
      expiresInDays: 30,
    });

    assert.deepStrictEqual(JSON.parse(seenBody), {
      name: 'CLI token',
      expiresInDays: 30,
    });
    assert.deepStrictEqual(result, {
      id: 'tok_2',
      name: 'CLI token',
      token: 'tok_secret',
    });
  });

  it('maps upstream create conflicts to TRPC conflict errors', async () => {
    mockFetch(async () => errorResponse(409, 'Token name already exists'));

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).create({
        name: 'Duplicate',
      }),
      'CONFLICT',
      /already exists/i
    );
  });

  it('revokes tokens using the upstream response payload', async () => {
    const result = await (async () => {
      mockFetch(async () =>
        trpcResponse({
          success: true,
          revokedAt: '2026-03-07T12:00:00.000Z',
        })
      );

      return await apiTokensRouter.createCaller(createContext()).revoke({ id: 'tok_3' });
    })();

    assert.deepStrictEqual(result, {
      success: true,
      revokedAt: '2026-03-07T12:00:00.000Z',
    });
  });

  it('maps missing upstream tokens to not found on revoke', async () => {
    mockFetch(async () => errorResponse(404, 'Token not found'));

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).revoke({ id: 'missing-token' }),
      'NOT_FOUND',
      /not found/i
    );
  });

  it('regenerates tokens using the upstream response payload', async () => {
    mockFetch(async () =>
      trpcResponse({
        id: 'tok_4',
        name: 'Regenerated token',
        token: 'tok_regenerated_secret',
      })
    );

    const result = await apiTokensRouter.createCaller(createContext()).regenerate({ id: 'tok_4' });

    assert.deepStrictEqual(result, {
      id: 'tok_4',
      name: 'Regenerated token',
      token: 'tok_regenerated_secret',
    });
  });

  it('returns an internal error when regeneration cannot reach OpenPath', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });

    await expectTrpcError(
      apiTokensRouter.createCaller(createContext()).regenerate({ id: 'tok_4' }),
      'INTERNAL_SERVER_ERROR',
      /unavailable/i
    );
  });
});
