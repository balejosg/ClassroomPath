import { TEST_JWT_SECRET } from './helpers/test-env.js';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { TRPCError } from '@trpc/server';

import { ACCESS_COOKIE_NAME } from '../src/lib/session-cookies.js';
import { createContext } from '../src/trpc/context.js';
import { protectedProcedure, router } from '../src/trpc/trpc.js';

const probeRouter = router({
  probe: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.user.sub,
  })),
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function signToken(
  params: {
    type?: 'access' | 'refresh';
    issuer?: string;
    subject?: string;
  } = {}
): string {
  return jwt.sign(
    {
      sub: params.subject ?? 'context-auth-user',
      email: 'context-auth@test.local',
      name: 'Context Auth User',
      roles: [{ role: 'admin', groupIds: [] }],
      type: params.type ?? 'access',
    },
    TEST_JWT_SECRET,
    {
      issuer: params.issuer ?? 'openpath-api',
      expiresIn: '1h',
    }
  );
}

function mockFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response
): void {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) =>
    await handler(input, init);
}

function authMeOkResponse(token: string): Response {
  const decoded = jwt.decode(token) as jwt.JwtPayload & {
    email?: string;
    name?: string;
    roles?: Array<{ role?: string; groupIds?: string[] }>;
  };

  return new Response(
    JSON.stringify({
      result: {
        data: {
          user: {
            id: decoded.sub,
            email: decoded.email,
            name: decoded.name,
            roles: decoded.roles ?? [],
          },
        },
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function authMeUnauthorized(message = 'Invalid token'): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        data: { code: 'UNAUTHORIZED' },
      },
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function callProtectedProbe(headers: Record<string, string | undefined>) {
  const ctx = await createContext({
    req: { headers } as never,
    res: {} as never,
  });

  return await probeRouter.createCaller(ctx).probe();
}

async function expectTrpcError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedMessage: RegExp
): Promise<void> {
  try {
    await promise;
    assert.fail('expected protected procedure to throw');
  } catch (err) {
    assert.ok(err instanceof TRPCError);
    assert.strictEqual(err.code, expectedCode);
    assert.match(err.message, expectedMessage);
  }
}

describe('createContext auth hardening', () => {
  it('rejects wrong-issuer bearer tokens as unauthorized', async () => {
    const badIssuerToken = signToken({ issuer: 'classroompath-gateway' });

    mockFetch(async () => authMeUnauthorized('Invalid issuer'));

    await expectTrpcError(
      callProtectedProbe({ authorization: `Bearer ${badIssuerToken}` }),
      'UNAUTHORIZED',
      /invalid/i
    );
  });

  it('does not fall back to a cookie when a bearer token is present but invalid', async () => {
    const invalidBearerToken = signToken({ issuer: 'wrong-issuer' });
    const validCookieToken = signToken();
    const seenAuthorizationHeaders: string[] = [];

    mockFetch(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization) {
        seenAuthorizationHeaders.push(headers.Authorization);
      }

      return authMeUnauthorized('Invalid token');
    });

    await expectTrpcError(
      callProtectedProbe({
        authorization: `Bearer ${invalidBearerToken}`,
        cookie: `${ACCESS_COOKIE_NAME}=${validCookieToken}`,
      }),
      'UNAUTHORIZED',
      /invalid/i
    );

    assert.deepStrictEqual(seenAuthorizationHeaders, [`Bearer ${invalidBearerToken}`]);
  });

  it('returns service unavailable when auth upstream cannot validate a presented token', async () => {
    const token = signToken();

    mockFetch(async () => {
      throw new Error('upstream offline');
    });

    await expectTrpcError(
      callProtectedProbe({ authorization: `Bearer ${token}` }),
      'SERVICE_UNAVAILABLE',
      /auth/i
    );
  });

  it('accepts valid cookie-backed sessions', async () => {
    const token = signToken();
    const seenAuthorizationHeaders: string[] = [];

    mockFetch(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization) {
        seenAuthorizationHeaders.push(headers.Authorization);
      }

      return authMeOkResponse(token);
    });

    const result = await callProtectedProbe({
      cookie: `${ACCESS_COOKIE_NAME}=${token}`,
    });

    assert.deepStrictEqual(result, { userId: 'context-auth-user' });
    assert.deepStrictEqual(seenAuthorizationHeaders, [`Bearer ${token}`]);
  });
});
